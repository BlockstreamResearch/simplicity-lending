use simplex::{
    provider::SimplicityNetwork,
    simplicityhl::elements::{AssetId, OutPoint, Script, Transaction, TxOut, hashes::Hash},
};

use lending_contracts::programs::{
    issuance_factory::{IssuanceFactory, IssuanceFactoryParameters},
    program::SimplexProgram,
};

use crate::{
    db::DbTx,
    indexer::trackers::{
        factory_auths::{FactoryAuthsTracker, insert_factory_auth_utxo},
        factory_creation::insert_factory,
    },
    models::{FactoryAuthModel, FactoryModel},
};

pub struct FactoryCreationsTracker {
    issuing_utxos_count: u8,
    reissuance_flags: u64,
    network: SimplicityNetwork,
}

impl FactoryCreationsTracker {
    pub fn new(issuing_utxos_count: u8, reissuance_flags: u64, network: SimplicityNetwork) -> Self {
        Self {
            issuing_utxos_count,
            reissuance_flags,
            network,
        }
    }

    pub async fn process_creation_tx(
        &self,
        sql_tx: &mut DbTx<'_>,
        tx: &Transaction,
        block_height: u64,
        factory_auths: &mut FactoryAuthsTracker,
    ) -> anyhow::Result<()> {
        if let Some((issuance_factory, factory_asset_id)) = self.is_factory_creation_tx(tx) {
            Self::handle_factory_creation(
                sql_tx,
                issuance_factory,
                factory_asset_id,
                tx,
                block_height,
                factory_auths,
            )
            .await?
        }

        Ok(())
    }

    async fn handle_factory_creation(
        sql_tx: &mut DbTx<'_>,
        issuance_factory: IssuanceFactory,
        factory_asset_id: AssetId,
        tx: &Transaction,
        block_height: u64,
        factory_auths: &mut FactoryAuthsTracker,
    ) -> anyhow::Result<()> {
        let txid = tx.txid();

        let factory_model =
            FactoryModel::new(&issuance_factory, factory_asset_id, block_height, txid);

        if insert_factory(sql_tx, &factory_model).await?.is_none() {
            tracing::debug!(%txid, "Factory already indexed, skipping");
            return Ok(());
        }

        let program_script_pubkey = issuance_factory.get_script_pubkey();
        let (auth_vout, auth_script_pubkey) =
            Self::find_factory_auth_output(tx, factory_asset_id, program_script_pubkey.as_bytes())
                .ok_or_else(|| {
                    anyhow::anyhow!("Factory auth output not found in validated creation tx {txid}")
                })?;

        let auth_outpoint = OutPoint {
            txid,
            vout: auth_vout,
        };

        let factory_auth = FactoryAuthModel {
            factory_id: factory_model.id,
            script_pubkey: auth_script_pubkey.to_bytes(),
            txid: txid.to_byte_array().to_vec(),
            vout: auth_vout as i32,
            created_at_height: block_height as i64,
            spent_txid: None,
            spent_at_height: None,
        };

        insert_factory_auth_utxo(sql_tx, &factory_auth).await?;
        factory_auths.watch_insert(auth_outpoint, factory_model.id);

        tracing::info!(
            factory_id = %factory_model.id,
            %txid,
            ?auth_outpoint,
            "Factory auth UTXO indexed on factory creation"
        );

        Ok(())
    }

    fn find_factory_auth_output<'a>(
        tx: &'a Transaction,
        factory_asset_id: AssetId,
        program_script_pubkey: &[u8],
    ) -> Option<(u32, &'a Script)> {
        tx.output.iter().enumerate().find_map(|(vout, output)| {
            if Self::is_factory_auth_output(output, factory_asset_id, program_script_pubkey) {
                Some((vout as u32, &output.script_pubkey))
            } else {
                None
            }
        })
    }

    fn is_factory_auth_output(
        output: &TxOut,
        factory_asset_id: AssetId,
        program_script_pubkey: &[u8],
    ) -> bool {
        let (Some(asset_id), Some(amount)) = (output.asset.explicit(), output.value.explicit())
        else {
            return false;
        };

        asset_id == factory_asset_id
            && amount == 1
            && !output.script_pubkey.is_op_return()
            && output.script_pubkey.as_bytes() != program_script_pubkey
    }

    fn is_factory_creation_tx(&self, tx: &Transaction) -> Option<(IssuanceFactory, AssetId)> {
        let (issuance_factory, factory_asset_id) =
            IssuanceFactory::try_from_tx(tx, self.network).ok()?;

        if !self.verify_factory_parameters(issuance_factory.get_parameters()) {
            return None;
        }

        Some((issuance_factory, factory_asset_id))
    }

    fn verify_factory_parameters(&self, factory_parameters: &IssuanceFactoryParameters) -> bool {
        factory_parameters.issuing_utxos_count == self.issuing_utxos_count
            && factory_parameters.reissuance_flags == self.reissuance_flags
    }
}
