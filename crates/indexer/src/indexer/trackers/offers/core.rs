use sqlx::PgPool;

use lending_contracts::programs::lending::LendingOfferRepaymentScan;
use simplex::{
    provider::SimplicityNetwork,
    simplicityhl::elements::{OutPoint, Transaction, Txid, hashes::Hash},
};

use crate::{
    db::DbTx,
    indexer::cache::WatchCache,
    indexer::trackers::offers::{
        ActiveOfferSpendKind, classify_active_offer_spend, fetch_offer, insert_offer_repayment,
        insert_offer_utxo, load_offer_utxos_cache, partial_repayment_amounts_from_scan,
        spend_offer_utxo, update_offer_debt_and_collateral, update_offer_status,
    },
    models::{OfferModel, OfferRepaymentModel, OfferStatus, OfferUtxoModel, UtxoType},
};

#[derive(Debug, Clone, Copy)]
pub struct OffersWatchEntry {
    pub offer_id: i64,
    pub utxo_type: UtxoType,
}

pub struct OffersTracker {
    cache: WatchCache<OffersWatchEntry>,
    network: SimplicityNetwork,
}

impl OffersTracker {
    pub async fn load(db_pool: &PgPool, network: SimplicityNetwork) -> anyhow::Result<Self> {
        Ok(Self {
            cache: load_offer_utxos_cache(db_pool).await?,
            network,
        })
    }

    pub async fn process_tx_spends(
        &mut self,
        sql_tx: &mut DbTx<'_>,
        tx: &Transaction,
        block_height: u64,
    ) -> anyhow::Result<bool> {
        let mut offer_spent = false;

        for input in &tx.input {
            if let Some(entry) = self.cache.get(&input.previous_output) {
                self.on_spend(
                    sql_tx,
                    tx,
                    &input.previous_output,
                    entry.offer_id,
                    entry.utxo_type,
                    block_height,
                )
                .await?;

                offer_spent = true;
            }
        }

        Ok(offer_spent)
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

    pub async fn seed_creation_pending_offer_utxo(
        &mut self,
        sql_tx: &mut DbTx<'_>,
        offer_id: i64,
        txid: Txid,
        vout: u32,
        block_height: u64,
    ) -> anyhow::Result<()> {
        let offer_utxo =
            Self::new_offer_utxo_model(offer_id, txid, vout, UtxoType::PendingOffer, block_height);

        let outpoint = OutPoint { txid, vout };

        insert_offer_utxo(sql_tx, &offer_utxo).await?;
        self.cache.insert(
            outpoint,
            OffersWatchEntry {
                offer_id,
                utxo_type: UtxoType::PendingOffer,
            },
        );

        tracing::info!(
            %offer_id,
            %txid,
            ?outpoint,
            "Offer UTXO indexed on offer creation"
        );

        Ok(())
    }

    fn new_offer_utxo_model(
        offer_id: i64,
        txid: Txid,
        vout: u32,
        utxo_type: UtxoType,
        block_height: u64,
    ) -> OfferUtxoModel {
        OfferUtxoModel {
            offer_id,
            txid: txid.to_byte_array().to_vec(),
            vout: vout as i32,
            utxo_type,
            created_at_height: block_height as i64,
            spent_at_height: None,
            spent_txid: None,
        }
    }

    async fn on_spend(
        &mut self,
        sql_tx: &mut DbTx<'_>,
        tx: &Transaction,
        old_outpoint: &OutPoint,
        offer_id: i64,
        utxo_type: UtxoType,
        block_height: u64,
    ) -> anyhow::Result<()> {
        let txid = tx.txid();

        match utxo_type {
            UtxoType::PendingOffer => {
                if Self::is_offer_cancellation_tx(tx) {
                    self.handle_offer_cancellation(
                        sql_tx,
                        old_outpoint,
                        offer_id,
                        txid,
                        block_height,
                    )
                    .await
                } else {
                    self.handle_offer_acceptance(sql_tx, old_outpoint, offer_id, txid, block_height)
                        .await
                }
            }
            UtxoType::ActiveOffer => {
                let offer_model = fetch_offer(sql_tx, offer_id).await?;
                let offer = offer_model.to_active_lending_offer(self.network)?;

                // TODO: pass vault prevout amounts once vault UTXOs are tracked.
                // `None` only discovers NoRepayments-phase (first) partials.
                match classify_active_offer_spend(&offer, tx, None)? {
                    ActiveOfferSpendKind::FullRepayment { scan } => {
                        self.handle_loan_repayment(
                            sql_tx,
                            old_outpoint,
                            offer_id,
                            txid,
                            &offer_model,
                            &scan,
                            block_height,
                        )
                        .await
                    }
                    ActiveOfferSpendKind::PartialRepayment { scan } => {
                        self.handle_partial_repayment(
                            sql_tx,
                            old_outpoint,
                            offer_id,
                            txid,
                            &offer_model,
                            &scan,
                            block_height,
                        )
                        .await
                    }
                    ActiveOfferSpendKind::Liquidation => {
                        self.handle_loan_liquidation(
                            sql_tx,
                            old_outpoint,
                            offer_id,
                            txid,
                            block_height,
                        )
                        .await
                    }
                }
            }
            UtxoType::Repayment => {
                self.handle_repayment_claim(sql_tx, old_outpoint, offer_id, txid, block_height)
                    .await
            }
            UtxoType::BorrowerPrincipal => {
                self.handle_borrower_principal_spend(
                    sql_tx,
                    old_outpoint,
                    offer_id,
                    txid,
                    block_height,
                )
                .await
            }
            _ => {
                tracing::warn!("Unexpected transition for UTXO type: {:?}", utxo_type);

                Ok(())
            }
        }
    }

    #[tracing::instrument(
        name = "Handling offer cancellation",
        skip(self, sql_tx, old_outpoint, offer_id, txid, block_height),
        fields(%offer_id, %txid, %block_height),
    )]
    async fn handle_offer_cancellation(
        &mut self,
        sql_tx: &mut DbTx<'_>,
        old_outpoint: &OutPoint,
        offer_id: i64,
        txid: Txid,
        block_height: u64,
    ) -> anyhow::Result<()> {
        spend_offer_utxo(sql_tx, old_outpoint, block_height, txid).await?;
        self.cache.remove(old_outpoint);

        update_offer_status(sql_tx, offer_id, OfferStatus::Cancelled, block_height).await?;
        update_offer_debt_and_collateral(sql_tx, offer_id, 0, 0, block_height).await?;

        let cancellation_outpoint = OutPoint { txid, vout: 0 };

        let cancellation_utxo = OfferUtxoModel {
            offer_id,
            txid: cancellation_outpoint.txid.to_byte_array().to_vec(),
            vout: cancellation_outpoint.vout as i32,
            utxo_type: UtxoType::Cancellation,
            created_at_height: block_height as i64,

            // Marked as spent immediately to:
            // 1. Exclude from cache on restart (WHERE spent_txid IS NULL)
            // 2. Preserve a permanent audit trail in database
            spent_at_height: Some(block_height as i64),
            spent_txid: Some(txid.to_byte_array().to_vec()),
        };

        insert_offer_utxo(sql_tx, &cancellation_utxo).await?;

        tracing::info!(%offer_id, "Offer archived");
        Ok(())
    }

    #[tracing::instrument(
        name = "Handling pending offer acceptance",
        skip(self, sql_tx, old_outpoint, offer_id, txid, block_height),
        fields(%offer_id, %txid, %block_height),
    )]
    async fn handle_offer_acceptance(
        &mut self,
        sql_tx: &mut DbTx<'_>,
        old_outpoint: &OutPoint,
        offer_id: i64,
        txid: Txid,
        block_height: u64,
    ) -> anyhow::Result<()> {
        spend_offer_utxo(sql_tx, old_outpoint, block_height, txid).await?;
        self.cache.remove(old_outpoint);

        update_offer_status(sql_tx, offer_id, OfferStatus::Active, block_height).await?;

        let lending_outpoint = OutPoint { txid, vout: 0 };
        let lending_offer_utxo = OfferUtxoModel {
            offer_id,
            txid: lending_outpoint.txid.to_byte_array().to_vec(),
            vout: lending_outpoint.vout as i32,
            utxo_type: UtxoType::ActiveOffer,
            created_at_height: block_height as i64,
            spent_at_height: None,
            spent_txid: None,
        };

        insert_offer_utxo(sql_tx, &lending_offer_utxo).await?;

        self.cache.insert(
            lending_outpoint,
            OffersWatchEntry {
                offer_id,
                utxo_type: UtxoType::ActiveOffer,
            },
        );

        let borrower_principal_outpoint = OutPoint { txid, vout: 1 };
        let borrower_principal_utxo = OfferUtxoModel {
            offer_id,
            txid: borrower_principal_outpoint.txid.to_byte_array().to_vec(),
            vout: borrower_principal_outpoint.vout as i32,
            utxo_type: UtxoType::BorrowerPrincipal,
            created_at_height: block_height as i64,
            spent_at_height: None,
            spent_txid: None,
        };

        insert_offer_utxo(sql_tx, &borrower_principal_utxo).await?;

        self.cache.insert(
            borrower_principal_outpoint,
            OffersWatchEntry {
                offer_id,
                utxo_type: UtxoType::BorrowerPrincipal,
            },
        );

        Ok(())
    }

    #[tracing::instrument(
        name = "Handling borrower principal spend",
        skip(self, sql_tx, old_outpoint, offer_id, txid, block_height),
        fields(%offer_id, %txid, %block_height),
    )]
    async fn handle_borrower_principal_spend(
        &mut self,
        sql_tx: &mut DbTx<'_>,
        old_outpoint: &OutPoint,
        offer_id: i64,
        txid: Txid,
        block_height: u64,
    ) -> anyhow::Result<()> {
        spend_offer_utxo(sql_tx, old_outpoint, block_height, txid).await?;
        self.cache.remove(old_outpoint);

        tracing::info!(%offer_id, "Borrower principal UTXO spent");
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    #[tracing::instrument(
        name = "Handling partial offer repayment",
        skip(self, sql_tx, old_outpoint, offer_model, scan, block_height),
        fields(%offer_id, %txid, %block_height),
    )]
    async fn handle_partial_repayment(
        &mut self,
        sql_tx: &mut DbTx<'_>,
        old_outpoint: &OutPoint,
        offer_id: i64,
        txid: Txid,
        offer_model: &OfferModel,
        scan: &LendingOfferRepaymentScan,
        block_height: u64,
    ) -> anyhow::Result<()> {
        let continuing_vout = scan.continuing_offer_vout.ok_or_else(|| {
            anyhow::anyhow!("partial repayment scan missing continuing_offer_vout")
        })?;

        let amounts =
            partial_repayment_amounts_from_scan(scan, offer_model.collateral_remaining as u64)?;

        spend_offer_utxo(sql_tx, old_outpoint, block_height, txid).await?;
        self.cache.remove(old_outpoint);

        update_offer_debt_and_collateral(
            sql_tx,
            offer_id,
            amounts.debt_after as i64,
            amounts.collateral_after as i64,
            block_height,
        )
        .await?;

        insert_offer_repayment(
            sql_tx,
            &OfferRepaymentModel {
                id: 0,
                offer_id,
                txid: txid.to_byte_array().to_vec(),
                height: block_height as i64,
                amount_repaid: amounts.amount_repaid as i64,
                collateral_unlocked: amounts.collateral_unlocked as i64,
                debt_before: amounts.debt_before as i64,
                debt_after: amounts.debt_after as i64,
                collateral_before: amounts.collateral_before as i64,
                collateral_after: amounts.collateral_after as i64,
                is_full: false,
            },
        )
        .await?;

        let continuing_outpoint = OutPoint {
            txid,
            vout: continuing_vout,
        };
        let continuing_utxo = Self::new_offer_utxo_model(
            offer_id,
            txid,
            continuing_vout,
            UtxoType::ActiveOffer,
            block_height,
        );

        insert_offer_utxo(sql_tx, &continuing_utxo).await?;
        self.cache.insert(
            continuing_outpoint,
            OffersWatchEntry {
                offer_id,
                utxo_type: UtxoType::ActiveOffer,
            },
        );

        tracing::info!(
            %offer_id,
            %txid,
            %continuing_vout,
            amount_repaid = amounts.amount_repaid,
            debt_after = amounts.debt_after,
            collateral_after = amounts.collateral_after,
            "Partial repayment indexed"
        );

        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    #[tracing::instrument(
        name = "Handling offer repayment",
        skip(self, sql_tx, old_outpoint, offer_id, txid, offer_model, scan, block_height),
        fields(%offer_id, %txid, %block_height),
    )]
    async fn handle_loan_repayment(
        &mut self,
        sql_tx: &mut DbTx<'_>,
        old_outpoint: &OutPoint,
        offer_id: i64,
        txid: Txid,
        offer_model: &OfferModel,
        scan: &LendingOfferRepaymentScan,
        block_height: u64,
    ) -> anyhow::Result<()> {
        spend_offer_utxo(sql_tx, old_outpoint, block_height, txid).await?;
        self.cache.remove(old_outpoint);

        insert_offer_repayment(
            sql_tx,
            &OfferRepaymentModel {
                id: 0,
                offer_id,
                txid: txid.to_byte_array().to_vec(),
                height: block_height as i64,
                amount_repaid: scan.amount_to_repay as i64,
                collateral_unlocked: offer_model.collateral_remaining,
                debt_before: scan.debt_before as i64,
                debt_after: scan.debt_after as i64,
                collateral_before: offer_model.collateral_remaining,
                collateral_after: 0,
                is_full: true,
            },
        )
        .await?;

        update_offer_debt_and_collateral(sql_tx, offer_id, 0, 0, block_height).await?;
        update_offer_status(sql_tx, offer_id, OfferStatus::Repaid, block_height).await?;

        let repayment_outpoint = OutPoint { txid, vout: 1 };
        let repayment_utxo = OfferUtxoModel {
            offer_id,
            txid: repayment_outpoint.txid.to_byte_array().to_vec(),
            vout: repayment_outpoint.vout as i32,
            utxo_type: UtxoType::Repayment,
            created_at_height: block_height as i64,
            spent_at_height: None,
            spent_txid: None,
        };

        insert_offer_utxo(sql_tx, &repayment_utxo).await?;

        self.cache.insert(
            repayment_outpoint,
            OffersWatchEntry {
                offer_id,
                utxo_type: UtxoType::Repayment,
            },
        );

        Ok(())
    }

    #[tracing::instrument(
        name = "Handling offer liquidation",
        skip(self, sql_tx, old_outpoint, offer_id, txid, block_height),
        fields(%offer_id, %txid, %block_height),
    )]
    async fn handle_loan_liquidation(
        &mut self,
        sql_tx: &mut DbTx<'_>,
        old_outpoint: &OutPoint,
        offer_id: i64,
        txid: Txid,
        block_height: u64,
    ) -> anyhow::Result<()> {
        spend_offer_utxo(sql_tx, old_outpoint, block_height, txid).await?;
        self.cache.remove(old_outpoint);

        update_offer_debt_and_collateral(sql_tx, offer_id, 0, 0, block_height).await?;
        update_offer_status(sql_tx, offer_id, OfferStatus::Liquidated, block_height).await?;

        let repayment_outpoint = OutPoint { txid, vout: 0 };
        let repayment_utxo = OfferUtxoModel {
            offer_id,
            txid: repayment_outpoint.txid.to_byte_array().to_vec(),
            vout: repayment_outpoint.vout as i32,
            utxo_type: UtxoType::Repayment,
            created_at_height: block_height as i64,

            // Marked as spent immediately to:
            // 1. Exclude from cache on restart (WHERE spent_txid IS NULL)
            // 2. Preserve a permanent audit trail in database
            spent_at_height: Some(block_height as i64),
            spent_txid: Some(txid.to_byte_array().to_vec()),
        };

        insert_offer_utxo(sql_tx, &repayment_utxo).await?;

        tracing::info!(%offer_id, "Offer archived");
        Ok(())
    }

    #[tracing::instrument(
        name = "Handling repayment tokens claim",
        skip(self, sql_tx, old_outpoint, offer_id, txid, block_height),
        fields(%offer_id, %txid, %block_height),
    )]
    async fn handle_repayment_claim(
        &mut self,
        sql_tx: &mut DbTx<'_>,
        old_outpoint: &OutPoint,
        offer_id: i64,
        txid: Txid,
        block_height: u64,
    ) -> anyhow::Result<()> {
        spend_offer_utxo(sql_tx, old_outpoint, block_height, txid).await?;
        self.cache.remove(old_outpoint);

        update_offer_status(sql_tx, offer_id, OfferStatus::Claimed, block_height).await?;

        let claim_outpoint = OutPoint { txid, vout: 1 };

        let claim_utxo = OfferUtxoModel {
            offer_id,
            txid: claim_outpoint.txid.to_byte_array().to_vec(),
            vout: claim_outpoint.vout as i32,
            utxo_type: UtxoType::Claim,
            created_at_height: block_height as i64,

            // Marked as spent immediately to:
            // 1. Exclude from cache on restart (WHERE spent_txid IS NULL)
            // 2. Preserve a permanent audit trail in database
            spent_at_height: Some(block_height as i64),
            spent_txid: Some(txid.to_byte_array().to_vec()),
        };

        insert_offer_utxo(sql_tx, &claim_utxo).await?;

        tracing::info!(%offer_id, "Offer archived");
        Ok(())
    }

    fn is_offer_cancellation_tx(tx: &Transaction) -> bool {
        if tx.output.len() < 4 {
            return false;
        }

        tx.output[0].is_null_data() && tx.output[1].is_null_data() && !tx.output[2].is_null_data()
    }
}
