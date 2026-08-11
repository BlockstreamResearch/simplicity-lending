use simplex::{
    provider::SimplicityNetwork,
    simplicityhl::elements::{Transaction, hex::ToHex},
};

use lending_contracts::programs::issuance_factory::{
    IssuanceFactory, IssuanceFactoryCreation, IssuanceFactoryParameters,
};

use crate::{
    db::DbTx,
    events::{IndexerEvent, notify_indexer_event},
    indexer::{
        AssetContractKind, AssetRegistration, FactoriesTracker, FactoryAuthsTracker, insert_factory,
    },
    models::FactoryModel,
};

pub struct FactoryCreationsTracker {
    issuing_utxos_count: u8,
    reissuance_flags: u64,
    network: SimplicityNetwork,
    asset_registration: Option<AssetRegistration>,
}

impl FactoryCreationsTracker {
    pub fn new(
        issuing_utxos_count: u8,
        reissuance_flags: u64,
        network: SimplicityNetwork,
        asset_registration: Option<AssetRegistration>,
    ) -> Self {
        Self {
            issuing_utxos_count,
            reissuance_flags,
            network,
            asset_registration,
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
        if let Some(created) = self.is_factory_creation_tx(tx) {
            let factory_asset_id = created.factory_asset_id;

            Self::handle_factory_creation(
                sql_tx,
                created,
                tx,
                block_height,
                factories,
                factory_auths,
            )
            .await?;

            // Best-effort ELIP-0100 metadata registration.
            // When the creation committed the expected asset contract, submit it to the registry.
            // Verifying the metadata remains the wallets' responsibility.
            if let Some(registration) = &self.asset_registration
                && let Some(contract) =
                    registration.verified_contract(AssetContractKind::Factory, tx, factory_asset_id)
            {
                registration.spawn_registration(factory_asset_id, contract);
            }
        }

        Ok(())
    }

    async fn handle_factory_creation(
        sql_tx: &mut DbTx<'_>,
        created: IssuanceFactoryCreation,
        tx: &Transaction,
        block_height: u64,
        factories: &mut FactoriesTracker,
        factory_auths: &mut FactoryAuthsTracker,
    ) -> anyhow::Result<()> {
        let txid = tx.txid();
        let auth_script_pubkey = created.auth_script_pubkey.to_bytes();

        let factory_model = FactoryModel::new(
            &created.factory,
            created.factory_asset_id,
            block_height,
            txid,
        );

        let Some(factory_id) = insert_factory(sql_tx, &factory_model).await? else {
            tracing::debug!(%txid, "Factory already indexed, skipping");
            return Ok(());
        };

        factory_auths
            .seed_creation_auth_utxo(
                sql_tx,
                factory_id,
                txid,
                created.auth_vout,
                &auth_script_pubkey,
                block_height,
            )
            .await?;

        factories
            .seed_creation_program_utxo(
                sql_tx,
                factory_id,
                txid,
                created.program_vout,
                block_height,
            )
            .await?;

        notify_indexer_event(
            sql_tx,
            &IndexerEvent::FactoryCreated {
                id: factory_id,
                height: block_height,
                factory_auth_script_pubkey: auth_script_pubkey.to_hex(),
            },
        )
        .await?;

        Ok(())
    }

    fn is_factory_creation_tx(&self, tx: &Transaction) -> Option<IssuanceFactoryCreation> {
        let created = IssuanceFactory::try_from_tx(tx, self.network).ok()?;

        if !self.verify_factory_parameters(created.factory.get_parameters()) {
            return None;
        }

        Some(created)
    }

    fn verify_factory_parameters(&self, factory_parameters: &IssuanceFactoryParameters) -> bool {
        factory_parameters.issuing_utxos_count == self.issuing_utxos_count
            && factory_parameters.reissuance_flags == self.reissuance_flags
    }
}
