use simplex::{
    provider::SimplicityNetwork,
    simplicityhl::elements::{OutPoint, Transaction, hashes::Hash},
};
use sqlx::PgPool;

use crate::{
    db::DbTx,
    indexer::{
        cache::WatchCache,
        trackers::offer_vaults::{insert_offer_vault, load_offer_vaults_cache, spend_offer_vault},
        trackers::offers::fetch_offer_parameters,
    },
    models::{OfferVaultModel, VaultType},
};
use lending_contracts::programs::{
    asset_auth_vault::{AssetAuthVault, AssetAuthVaultParameters, AssetAuthVaultTxKind},
    lending::LendingOfferParameters,
};

#[derive(Debug, Clone, Copy)]
pub struct VaultWatchEntry {
    pub offer_id: i64,
    pub vault_type: VaultType,
    /// Physical amount of this UTXO (may differ from `already_supplied` after a WithdrawPart).
    pub amount: u64,
    /// `already_supplied` storage slot value of the covenant — needed to reconstruct
    /// `AssetAuthVault::new_active` for classification.
    pub already_supplied: u64,
    pub is_finalized: bool,
}

pub struct VaultsTracker {
    cache: WatchCache<VaultWatchEntry>,
    network: SimplicityNetwork,
}

impl VaultsTracker {
    pub async fn load(db_pool: &PgPool, network: SimplicityNetwork) -> anyhow::Result<Self> {
        Ok(Self {
            cache: load_offer_vaults_cache(db_pool).await?,
            network,
        })
    }

    pub fn begin_block(&mut self) {
        self.cache.begin_block();
    }

    pub fn commit_block(&mut self) {
        self.cache.commit_block();
    }

    pub fn abort_block(&mut self) {
        self.cache.abort_block();
    }

    /// Process all inputs in `tx` that are vault UTXOs we track.
    /// Must be called **before** `OffersTracker::process_tx_spends` so that
    /// `get_vault_amount` reflects pre-spend state when `classify_active_offer_spend` runs.
    pub async fn process_tx_spends(
        &mut self,
        sql_tx: &mut DbTx<'_>,
        tx: &Transaction,
        block_height: u64,
    ) -> anyhow::Result<()> {
        for input in &tx.input {
            if let Some(entry) = self.cache.get(&input.previous_output).copied() {
                self.on_vault_spend(sql_tx, tx, &input.previous_output, entry, block_height)
                    .await?;
            }
        }

        Ok(())
    }

    /// Return the current (pre-spend) amount held in a vault for the given offer, if tracked.
    pub fn get_vault_amount(&self, offer_id: i64, vault_type: VaultType) -> Option<u64> {
        self.cache
            .find(|_, e| e.offer_id == offer_id && e.vault_type == vault_type)
            .map(|(_, e)| e.amount)
    }

    /// Index a newly created vault output — called by `OffersTracker` on the **first** repayment,
    /// when no vault UTXO for this offer existed before.
    pub async fn create_vault(
        &mut self,
        sql_tx: &mut DbTx<'_>,
        outpoint: OutPoint,
        entry: VaultWatchEntry,
        block_height: u64,
    ) -> anyhow::Result<()> {
        self.index_vault(sql_tx, outpoint, entry, block_height)
            .await
    }

    /// Handle a Supply/FinalSupply spend of an existing vault — called by `OffersTracker` on the
    /// **second and subsequent** repayments, when a vault UTXO was already spent (and removed from
    /// cache) by `process_tx_spends` earlier in the same transaction.
    ///
    /// At this point the old vault is already marked spent in the DB and removed from the cache by
    /// `on_vault_spend`. This method inserts the new continuing vault output.
    pub async fn supply_vault(
        &mut self,
        sql_tx: &mut DbTx<'_>,
        offer_id: i64,
        vault_type: VaultType,
        tx: &Transaction,
        debt_after: u64,
        offer_params: &LendingOfferParameters,
        block_height: u64,
    ) -> anyhow::Result<()> {
        let txid = tx.txid();
        let vault_params = vault_type.vault_parameters(offer_params);
        let vault_after = vault_type.get_vault(offer_params, debt_after);

        let (vout, amount, already_supplied, is_finalized) = if vault_after.is_finalized_offer() {
            let scan = vault_after
                .scan_final_supply(tx)
                .ok_or_else(|| anyhow::anyhow!("supply_vault: FinalSupply scan failed"))?;
            (
                scan.vault_vout,
                scan.vault_amount_after,
                vault_params.supply_goal,
                true,
            )
        } else {
            let already_supplied_after = vault_after.get_already_supplied_amount();
            let (vault_vout, vault_amount_after) =
                vault_after.find_unique_vout_matching(tx).ok_or_else(|| {
                    anyhow::anyhow!("supply_vault: could not find vault output in tx")
                })?;
            (
                vault_vout,
                vault_amount_after,
                already_supplied_after,
                false,
            )
        };

        self.index_vault(
            sql_tx,
            OutPoint { txid, vout },
            VaultWatchEntry {
                offer_id,
                vault_type,
                amount,
                already_supplied,
                is_finalized,
            },
            block_height,
        )
        .await
    }

    async fn on_vault_spend(
        &mut self,
        sql_tx: &mut DbTx<'_>,
        tx: &Transaction,
        old_outpoint: &OutPoint,
        entry: VaultWatchEntry,
        block_height: u64,
    ) -> anyhow::Result<()> {
        let txid = tx.txid();

        // Reconstruct the vault contract to classify the spend.
        let offer_params = fetch_offer_parameters(sql_tx, entry.offer_id, self.network).await?;
        let vault_params = entry.vault_type.vault_parameters(&offer_params);

        let vault = if entry.is_finalized {
            AssetAuthVault::new_finalized(vault_params)
        } else {
            AssetAuthVault::new_active(vault_params, entry.already_supplied)
        };

        let kind = vault.classify_tx(tx);

        spend_offer_vault(sql_tx, old_outpoint, block_height, txid).await?;
        self.cache.remove(old_outpoint);

        match kind {
            Some(AssetAuthVaultTxKind::WithdrawAll) => {
                tracing::info!(
                    offer_id = %entry.offer_id,
                    vault_type = ?entry.vault_type,
                    %txid,
                    "Vault fully withdrawn"
                );
            }

            Some(AssetAuthVaultTxKind::WithdrawPart) => {
                let scan = vault.scan_withdraw_part(tx).ok_or_else(|| {
                    anyhow::anyhow!("WithdrawPart classified but scan returned None")
                })?;

                self.index_vault(
                    sql_tx,
                    OutPoint {
                        txid,
                        vout: scan.vault_vout,
                    },
                    VaultWatchEntry {
                        offer_id: entry.offer_id,
                        vault_type: entry.vault_type,
                        amount: scan.vault_amount_after,
                        already_supplied: scan.already_supplied,
                        is_finalized: false,
                    },
                    block_height,
                )
                .await?;
            }

            Some(AssetAuthVaultTxKind::FinalSupply) => {
                let scan = vault.scan_final_supply(tx).ok_or_else(|| {
                    anyhow::anyhow!("FinalSupply classified but scan returned None")
                })?;

                self.index_vault(
                    sql_tx,
                    OutPoint {
                        txid,
                        vout: scan.vault_vout,
                    },
                    VaultWatchEntry {
                        offer_id: entry.offer_id,
                        vault_type: entry.vault_type,
                        amount: scan.vault_amount_after,
                        already_supplied: vault_params.supply_goal,
                        is_finalized: true,
                    },
                    block_height,
                )
                .await?;
            }

            // `Supply` is never returned by `classify_tx` (requires `classify_supply_tx` with a
            // known amount). Vault Supply spends happen during repayments and are handled by
            // `OffersTracker` via `supply_vault` — the old UTXO is spent here, the new one is
            // inserted there.
            Some(AssetAuthVaultTxKind::Supply) | None => {
                tracing::debug!(
                    offer_id = %entry.offer_id,
                    vault_type = ?entry.vault_type,
                    "Vault UTXO spent in repayment context; new output will be indexed by OffersTracker"
                );
            }
        }

        Ok(())
    }

    async fn index_vault(
        &mut self,
        sql_tx: &mut DbTx<'_>,
        outpoint: OutPoint,
        entry: VaultWatchEntry,
        block_height: u64,
    ) -> anyhow::Result<()> {
        let model = OfferVaultModel {
            id: 0,
            offer_id: entry.offer_id,
            vault_type: entry.vault_type,
            txid: outpoint.txid.to_byte_array().to_vec(),
            vout: outpoint.vout as i32,
            amount: entry.amount as i64,
            is_finalized: entry.is_finalized,
            created_at_height: block_height as i64,
            updated_at_height: block_height as i64,
            spent_txid: None,
            spent_at_height: None,
        };

        insert_offer_vault(sql_tx, &model).await?;
        self.cache.insert(outpoint, entry);

        tracing::info!(
            offer_id = %entry.offer_id,
            vault_type = ?entry.vault_type,
            txid = %outpoint.txid,
            vout = %outpoint.vout,
            amount = %entry.amount,
            already_supplied = %entry.already_supplied,
            is_finalized = %entry.is_finalized,
            "Vault UTXO indexed"
        );

        Ok(())
    }
}

impl VaultType {
    pub fn vault_parameters(&self, params: &LendingOfferParameters) -> AssetAuthVaultParameters {
        match self {
            VaultType::Lender => params.get_lender_vault_parameters(),
            VaultType::ProtocolFee => params.get_protocol_fee_vault_parameters(),
        }
    }

    /// Reconstruct the vault contract at the given `current_debt` state.
    pub fn get_vault(&self, params: &LendingOfferParameters, current_debt: u64) -> AssetAuthVault {
        match self {
            VaultType::Lender => params.get_lender_vault(current_debt),
            VaultType::ProtocolFee => params.get_protocol_fee_vault(current_debt),
        }
    }
}
