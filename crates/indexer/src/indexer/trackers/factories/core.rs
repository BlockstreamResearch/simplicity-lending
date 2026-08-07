use sqlx::PgPool;
use uuid::Uuid;

use simplex::{
    provider::SimplicityNetwork,
    simplicityhl::elements::{AssetId, OutPoint, Transaction, Txid, hashes::Hash},
};

use lending_contracts::programs::issuance_factory::{
    IssuanceFactory, IssuanceFactoryParameters, IssuanceFactoryTxKind,
};

use crate::{
    db::DbTx,
    indexer::{
        cache::WatchCache, get_factory_identity, insert_factory_utxo, load_factory_utxos_cache,
        spend_factory_utxo, update_factory_status,
    },
    models::{FactoryStatus, FactoryUtxoModel},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum FactoryProgramTxEffect {
    #[default]
    None,
    AssetsIssued(Uuid),
    Removed(Uuid),
}

impl FactoryProgramTxEffect {
    pub fn issuance_factory_id(self) -> Option<Uuid> {
        match self {
            Self::AssetsIssued(factory_id) => Some(factory_id),
            _ => None,
        }
    }

    fn merge(self, other: Self) -> Self {
        match (self, other) {
            (Self::AssetsIssued(id), _) | (_, Self::AssetsIssued(id)) => Self::AssetsIssued(id),
            (Self::Removed(id), _) | (_, Self::Removed(id)) => Self::Removed(id),
            _ => Self::None,
        }
    }
}

pub struct FactoriesTracker {
    cache: WatchCache<Uuid>,
    network: SimplicityNetwork,
}

impl FactoriesTracker {
    pub async fn load(db_pool: &PgPool, network: SimplicityNetwork) -> anyhow::Result<Self> {
        Ok(Self {
            cache: load_factory_utxos_cache(db_pool).await?,
            network,
        })
    }

    pub async fn process_tx_spends(
        &mut self,
        sql_tx: &mut DbTx<'_>,
        tx: &Transaction,
        block_height: u64,
    ) -> anyhow::Result<FactoryProgramTxEffect> {
        let mut effect = FactoryProgramTxEffect::None;

        for input in &tx.input {
            let factory_id = self.cache.get(&input.previous_output).copied();
            if let Some(factory_id) = factory_id {
                let spend_effect = self
                    .on_spend(sql_tx, tx, &input.previous_output, factory_id, block_height)
                    .await?;
                effect = effect.merge(spend_effect);
            }
        }

        Ok(effect)
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

    pub async fn seed_creation_program_utxo(
        &mut self,
        sql_tx: &mut DbTx<'_>,
        factory_id: Uuid,
        txid: Txid,
        vout: u32,
        block_height: u64,
    ) -> anyhow::Result<()> {
        self.insert_factory_program_utxo(
            sql_tx,
            factory_id,
            txid,
            vout,
            block_height,
            "Factory program UTXO indexed on factory creation",
        )
        .await
    }

    async fn on_spend(
        &mut self,
        sql_tx: &mut DbTx<'_>,
        tx: &Transaction,
        old_outpoint: &OutPoint,
        factory_id: Uuid,
        block_height: u64,
    ) -> anyhow::Result<FactoryProgramTxEffect> {
        let txid = tx.txid();

        spend_factory_utxo(sql_tx, old_outpoint, block_height, txid).await?;
        self.cache.remove(old_outpoint);

        let factory_identity = get_factory_identity(sql_tx, factory_id).await?;
        let factory_asset_id = AssetId::from_slice(&factory_identity.factory_asset_id)
            .map_err(|e| anyhow::anyhow!("invalid factory_asset_id: {e}"))?;

        let factory = IssuanceFactory::new(IssuanceFactoryParameters {
            issuing_utxos_count: factory_identity.issuing_utxos_count as u8,
            reissuance_flags: factory_identity.reissuance_flags as u64,
            network: self.network,
        });

        match factory.classify_tx(tx, factory_asset_id) {
            Some(IssuanceFactoryTxKind::AssetsIssuance) => {
                let scan = factory
                    .scan_assets_issuance(tx, factory_asset_id)
                    .ok_or_else(|| {
                        anyhow::anyhow!(
                            "assets issuance classified but unique program output missing for {factory_id}"
                        )
                    })?;

                self.insert_factory_program_utxo(
                    sql_tx,
                    factory_id,
                    txid,
                    scan.program_vout,
                    block_height,
                    "Factory program UTXO moved to new location",
                )
                .await?;

                Ok(FactoryProgramTxEffect::AssetsIssued(factory_id))
            }
            Some(IssuanceFactoryTxKind::FactoryRemoval) => {
                update_factory_status(sql_tx, factory_id, FactoryStatus::Removed).await?;
                tracing::info!(
                    %factory_id,
                    %txid,
                    "Factory removal detected, program UTXO not recreated"
                );

                Ok(FactoryProgramTxEffect::Removed(factory_id))
            }
            Some(IssuanceFactoryTxKind::Creation) => {
                anyhow::bail!(
                    "unexpected factory creation layout while spending program UTXO for {factory_id}"
                );
            }
            None => {
                anyhow::bail!(
                    "spent factory program UTXO for {factory_id} in {txid} but tx was not classified as issuance or removal"
                );
            }
        }
    }

    async fn insert_factory_program_utxo(
        &mut self,
        sql_tx: &mut DbTx<'_>,
        factory_id: Uuid,
        txid: Txid,
        vout: u32,
        block_height: u64,
        log_message: &'static str,
    ) -> anyhow::Result<()> {
        let new_outpoint = OutPoint { txid, vout };

        let factory_utxo = FactoryUtxoModel {
            factory_id,
            txid: txid.to_byte_array().to_vec(),
            vout: vout as i32,
            created_at_height: block_height as i64,
            spent_txid: None,
            spent_at_height: None,
        };

        insert_factory_utxo(sql_tx, &factory_utxo).await?;
        self.cache.insert(new_outpoint, factory_id);

        tracing::info!(%factory_id, %txid, ?new_outpoint, message = log_message);

        Ok(())
    }
}
