use sqlx::PgPool;

use simplex::{
    provider::SimplicityNetwork,
    simplicityhl::elements::{AssetId, Transaction, hex::ToHex},
};

use crate::{
    db::DbTx,
    indexer::{
        FactoryAuthsTracker, FactoryCreationsTracker, OfferCreationsTracker,
        OfferParticipantsTracker, OffersTracker,
    },
};

pub struct TrackerRegistry {
    factory_auths: FactoryAuthsTracker,
    factory_creations: FactoryCreationsTracker,
    offers: OffersTracker,
    participants: OfferParticipantsTracker,
    creations: OfferCreationsTracker,
}

impl TrackerRegistry {
    pub async fn load(
        db_pool: &PgPool,
        protocol_fee_keeper_asset_id: AssetId,
        network: SimplicityNetwork,
    ) -> anyhow::Result<Self> {
        // TODO: move factory parameters to config
        Ok(Self {
            factory_auths: FactoryAuthsTracker::load(db_pool).await?,
            factory_creations: FactoryCreationsTracker::new(2, 0, network),
            offers: OffersTracker::load(db_pool).await?,
            participants: OfferParticipantsTracker::load(db_pool).await?,
            creations: OfferCreationsTracker::new(protocol_fee_keeper_asset_id, network),
        })
    }

    pub fn begin_block(&mut self) {
        self.factory_auths.begin_block();
        self.offers.begin_block();
        self.participants.begin_block();
    }

    pub fn commit_block(&mut self) {
        self.factory_auths.commit_block();
        self.offers.commit_block();
        self.participants.commit_block();
    }

    pub fn abort_block(&mut self) {
        self.factory_auths.abort_block();
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
        self.factory_auths
            .process_tx_spends(sql_tx, tx, block_height)
            .await?;

        let offer_spent = self
            .offers
            .process_tx_spends(sql_tx, tx, block_height)
            .await?;
        self.participants
            .process_tx_spends(sql_tx, tx, block_height)
            .await?;

        self.factory_creations
            .process_creation_tx(sql_tx, tx, block_height, &mut self.factory_auths)
            .await?;

        if !offer_spent {
            self.creations
                .process_creation_tx(
                    sql_tx,
                    tx,
                    block_height,
                    &mut self.offers,
                    &mut self.participants,
                )
                .await?;
        }

        Ok(())
    }
}
