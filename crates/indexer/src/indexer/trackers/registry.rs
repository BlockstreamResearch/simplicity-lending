use sqlx::PgPool;

use simplex::{
    provider::SimplicityNetwork,
    simplicityhl::elements::{AssetId, Transaction, hex::ToHex},
};

use crate::{
    db::DbTx,
    indexer::{
        AssetRegistration, FactoriesTracker, FactoryAuthsTracker, FactoryCreationsTracker,
        OfferCreationsTracker, OfferParticipantsTracker, OffersTracker, VaultsTracker,
    },
};

pub struct TrackerRegistry {
    factories: FactoriesTracker,
    factory_auths: FactoryAuthsTracker,
    factory_creations: FactoryCreationsTracker,
    vaults: VaultsTracker,
    offers: OffersTracker,
    participants: OfferParticipantsTracker,
    creations: OfferCreationsTracker,
}

impl TrackerRegistry {
    pub async fn load(
        db_pool: &PgPool,
        protocol_fee_keeper_asset_id: AssetId,
        network: SimplicityNetwork,
        asset_registration: Option<AssetRegistration>,
    ) -> anyhow::Result<Self> {
        // TODO: move factory parameters to config
        Ok(Self {
            factories: FactoriesTracker::load(db_pool, network).await?,
            factory_auths: FactoryAuthsTracker::load(db_pool).await?,
            factory_creations: FactoryCreationsTracker::new(
                2,
                0,
                network,
                asset_registration.clone(),
            ),
            vaults: VaultsTracker::load(db_pool, network).await?,
            offers: OffersTracker::load(db_pool, network).await?,
            participants: OfferParticipantsTracker::load(db_pool).await?,
            creations: OfferCreationsTracker::new(
                protocol_fee_keeper_asset_id,
                network,
                asset_registration,
            ),
        })
    }

    pub fn begin_block(&mut self) {
        self.factories.begin_block();
        self.factory_auths.begin_block();
        self.vaults.begin_block();
        self.offers.begin_block();
        self.participants.begin_block();
    }

    pub fn commit_block(&mut self) {
        self.factories.commit_block();
        self.factory_auths.commit_block();
        self.vaults.commit_block();
        self.offers.commit_block();
        self.participants.commit_block();
    }

    pub fn abort_block(&mut self) {
        self.factories.abort_block();
        self.factory_auths.abort_block();
        self.vaults.abort_block();
        self.offers.abort_block();
        self.participants.abort_block();
    }

    #[tracing::instrument(
        name = "Processing utxo tracking",
        skip(self, sql_tx, tx, block_height),
        fields(txid = %tx.txid().to_hex())
    )]
    pub async fn process_tx(
        &mut self,
        sql_tx: &mut DbTx<'_>,
        tx: &Transaction,
        block_height: u64,
    ) -> anyhow::Result<()> {
        let factory_effect = self
            .factories
            .process_tx_spends(sql_tx, tx, block_height)
            .await?;
        self.factory_auths
            .process_tx_spends(sql_tx, tx, block_height)
            .await?;

        // Vaults must be processed before offers so that vault amounts are
        // current when classify_active_offer_spend runs inside OffersTracker.
        self.vaults
            .process_tx_spends(sql_tx, tx, block_height)
            .await?;

        let offer_spent = self
            .offers
            .process_tx_spends(sql_tx, tx, block_height, &mut self.vaults)
            .await?;
        self.participants
            .process_tx_spends(sql_tx, tx, block_height)
            .await?;

        self.factory_creations
            .process_creation_tx(
                sql_tx,
                tx,
                block_height,
                &mut self.factories,
                &mut self.factory_auths,
            )
            .await?;

        if !offer_spent && let Some(factory_id) = factory_effect.issuance_factory_id() {
            self.creations
                .process_creation_tx(
                    sql_tx,
                    tx,
                    block_height,
                    factory_id,
                    &mut self.offers,
                    &mut self.participants,
                )
                .await?;
        }

        Ok(())
    }
}
