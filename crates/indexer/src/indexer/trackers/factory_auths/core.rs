use simplex::simplicityhl::elements::{OutPoint, Transaction, TxOut, Txid, hashes::Hash};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    db::DbTx,
    indexer::{
        cache::WatchCache, get_factory_identity, insert_factory_auth_utxo,
        load_factory_auth_utxo_cache, spend_factory_auth_utxo,
    },
    models::{FactoryAuthModel, FactoryIdentity},
};

pub struct FactoryAuthsTracker {
    cache: WatchCache<Uuid>,
}

impl FactoryAuthsTracker {
    pub async fn load(db_pool: &PgPool) -> anyhow::Result<Self> {
        Ok(Self {
            cache: load_factory_auth_utxo_cache(db_pool).await?,
        })
    }

    pub async fn process_tx_spends(
        &mut self,
        sql_tx: &mut DbTx<'_>,
        tx: &Transaction,
        block_height: u64,
    ) -> anyhow::Result<()> {
        for input in &tx.input {
            let factory_id = self.cache.get(&input.previous_output).copied();
            if let Some(factory_id) = factory_id {
                self.on_spend(sql_tx, tx, &input.previous_output, factory_id, block_height)
                    .await?;
            }
        }

        Ok(())
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

    pub async fn seed_creation_auth_utxo(
        &mut self,
        sql_tx: &mut DbTx<'_>,
        factory_id: Uuid,
        txid: Txid,
        vout: u32,
        script_pubkey: &[u8],
        block_height: u64,
    ) -> anyhow::Result<()> {
        let factory_auth =
            Self::new_factory_auth_model(factory_id, txid, vout, script_pubkey, block_height);

        self.insert_factory_auth(
            sql_tx,
            &factory_auth,
            "Factory auth UTXO indexed on factory creation",
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
    ) -> anyhow::Result<()> {
        let txid = tx.txid();

        spend_factory_auth_utxo(sql_tx, old_outpoint, block_height, txid).await?;
        self.cache.remove(old_outpoint);

        let factory_identity = get_factory_identity(sql_tx, factory_id).await?;

        let candidates = Self::collect_factory_asset_utxo_candidates(tx, &factory_identity);

        if candidates.is_empty() {
            tracing::info!(
                %factory_id,
                %txid,
                "Factory auth NFT was not found in outputs (burned)"
            );
            return Ok(());
        }

        if candidates.len() == 1 {
            let (vout, output) = candidates[0];
            let factory_auth = Self::new_factory_auth_model(
                factory_id,
                txid,
                vout,
                output.script_pubkey.as_bytes(),
                block_height,
            );

            return self
                .insert_factory_auth(
                    sql_tx,
                    &factory_auth,
                    "Factory auth NFT moved to new location",
                )
                .await;
        }

        if candidates
            .iter()
            .any(|(_, output)| output.script_pubkey.is_op_return())
        {
            tracing::info!(
                %factory_id,
                %txid,
                "Factory removal detected, auth UTXO not recreated"
            );
            return Ok(());
        }

        let Some((vout, output)) = candidates.iter().find(|(_, output)| {
            output.script_pubkey.as_bytes() != factory_identity.program_script_pubkey.as_slice()
        }) else {
            tracing::warn!(
                %factory_id,
                %txid,
                candidates = candidates.len(),
                "Ambiguous factory asset outputs, auth UTXO not recreated"
            );
            return Ok(());
        };

        let factory_auth = Self::new_factory_auth_model(
            factory_id,
            txid,
            *vout,
            output.script_pubkey.as_bytes(),
            block_height,
        );

        self.insert_factory_auth(
            sql_tx,
            &factory_auth,
            "Factory auth NFT moved to new location",
        )
        .await
    }

    fn collect_factory_asset_utxo_candidates<'a>(
        tx: &'a Transaction,
        factory_identity: &FactoryIdentity,
    ) -> Vec<(u32, &'a TxOut)> {
        tx.output
            .iter()
            .enumerate()
            .filter_map(|(vout, output)| {
                if Self::is_factory_asset_utxo_candidate(output, factory_identity) {
                    Some((vout as u32, output))
                } else {
                    None
                }
            })
            .collect()
    }

    fn is_factory_asset_utxo_candidate(output: &TxOut, factory_identity: &FactoryIdentity) -> bool {
        let (Some(asset_id), Some(amount)) = (output.asset.explicit(), output.value.explicit())
        else {
            return false;
        };

        asset_id.into_inner().0.as_slice() == factory_identity.factory_asset_id.as_slice()
            && amount == 1
    }

    async fn insert_factory_auth(
        &mut self,
        sql_tx: &mut DbTx<'_>,
        factory_auth: &FactoryAuthModel,
        log_message: &'static str,
    ) -> anyhow::Result<()> {
        let new_outpoint = OutPoint {
            txid: Txid::from_slice(&factory_auth.txid)?,
            vout: factory_auth.vout as u32,
        };

        insert_factory_auth_utxo(sql_tx, factory_auth).await?;
        self.cache.insert(new_outpoint, factory_auth.factory_id);

        tracing::info!(
            factory_id = %factory_auth.factory_id,
            txid = %new_outpoint.txid,
            ?new_outpoint,
            message = log_message
        );

        Ok(())
    }

    fn new_factory_auth_model(
        factory_id: Uuid,
        txid: Txid,
        vout: u32,
        script_pubkey: &[u8],
        block_height: u64,
    ) -> FactoryAuthModel {
        FactoryAuthModel {
            factory_id,
            script_pubkey: script_pubkey.to_vec(),
            txid: txid.to_byte_array().to_vec(),
            vout: vout as i32,
            created_at_height: block_height as i64,
            spent_txid: None,
            spent_at_height: None,
        }
    }
}
