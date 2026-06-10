use simplex::{
    provider::SimplicityNetwork,
    simplicityhl::elements::{AssetId, Transaction},
};

use lending_contracts::programs::issuance_factory::{IssuanceFactory, IssuanceFactoryParameters};

use crate::{
    db::DbTx,
    indexer::{FactoriesTracker, FactoryAuthsTracker, insert_factory, scan_creation_outputs},
    models::{FactoryIdentity, FactoryModel},
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
        factories: &mut FactoriesTracker,
        factory_auths: &mut FactoryAuthsTracker,
    ) -> anyhow::Result<()> {
        if let Some((issuance_factory, factory_asset_id)) = self.is_factory_creation_tx(tx) {
            Self::handle_factory_creation(
                sql_tx,
                issuance_factory,
                factory_asset_id,
                tx,
                block_height,
                factories,
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
        factories: &mut FactoriesTracker,
        factory_auths: &mut FactoryAuthsTracker,
    ) -> anyhow::Result<()> {
        let txid = tx.txid();

        let factory_model =
            FactoryModel::new(&issuance_factory, factory_asset_id, block_height, txid);

        if insert_factory(sql_tx, &factory_model).await?.is_none() {
            tracing::debug!(%txid, "Factory already indexed, skipping");
            return Ok(());
        }

        let identity = FactoryIdentity::from_factory_model(&factory_model);
        let outputs = scan_creation_outputs(&identity, tx).ok_or_else(|| {
            anyhow::anyhow!("Factory outputs not found in validated creation tx {txid}")
        })?;

        factory_auths
            .seed_creation_auth_utxo(
                sql_tx,
                factory_model.id,
                txid,
                outputs.auth_vout,
                &outputs.auth_script_pubkey,
                block_height,
            )
            .await?;

        factories
            .seed_creation_program_utxo(
                sql_tx,
                factory_model.id,
                txid,
                outputs.program_vout,
                block_height,
            )
            .await?;

        Ok(())
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
