use sqlx::PgPool;
use uuid::Uuid;

use simplex::simplicityhl::elements::{OutPoint, Transaction, Txid, hashes::Hash};

use crate::{
    db::DbTx,
    indexer::cache::WatchCache,
    indexer::trackers::offers::{
        insert_offer_utxo, load_offer_utxos_cache, spend_offer_utxo, update_offer_status,
    },
    models::{OfferStatus, OfferUtxoModel, UtxoType},
};

#[derive(Debug, Clone, Copy)]
pub struct OffersWatchEntry {
    pub offer_id: Uuid,
    pub utxo_type: UtxoType,
}

pub struct OffersTracker {
    cache: WatchCache<OffersWatchEntry>,
}

impl OffersTracker {
    pub async fn load(db_pool: &PgPool) -> anyhow::Result<Self> {
        Ok(Self {
            cache: load_offer_utxos_cache(db_pool).await?,
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
        offer_id: Uuid,
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
        offer_id: Uuid,
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
        offer_id: Uuid,
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
                if Self::is_loan_repayment_tx(tx) {
                    self.handle_loan_repayment(sql_tx, old_outpoint, offer_id, txid, block_height)
                        .await
                } else {
                    self.handle_loan_liquidation(sql_tx, old_outpoint, offer_id, txid, block_height)
                        .await
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
        offer_id: Uuid,
        txid: Txid,
        block_height: u64,
    ) -> anyhow::Result<()> {
        spend_offer_utxo(sql_tx, old_outpoint, block_height, txid).await?;
        self.cache.remove(old_outpoint);

        update_offer_status(sql_tx, offer_id, OfferStatus::Cancelled).await?;

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
        offer_id: Uuid,
        txid: Txid,
        block_height: u64,
    ) -> anyhow::Result<()> {
        spend_offer_utxo(sql_tx, old_outpoint, block_height, txid).await?;
        self.cache.remove(old_outpoint);

        update_offer_status(sql_tx, offer_id, OfferStatus::Active).await?;

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
        offer_id: Uuid,
        txid: Txid,
        block_height: u64,
    ) -> anyhow::Result<()> {
        spend_offer_utxo(sql_tx, old_outpoint, block_height, txid).await?;
        self.cache.remove(old_outpoint);

        tracing::info!(%offer_id, "Borrower principal UTXO spent");
        Ok(())
    }

    // TODO: Add partial repayment handling
    #[tracing::instrument(
        name = "Handling offer repayment",
        skip(self, sql_tx, old_outpoint, offer_id, txid, block_height),
        fields(%offer_id, %txid, %block_height),
    )]
    async fn handle_loan_repayment(
        &mut self,
        sql_tx: &mut DbTx<'_>,
        old_outpoint: &OutPoint,
        offer_id: Uuid,
        txid: Txid,
        block_height: u64,
    ) -> anyhow::Result<()> {
        spend_offer_utxo(sql_tx, old_outpoint, block_height, txid).await?;
        self.cache.remove(old_outpoint);

        update_offer_status(sql_tx, offer_id, OfferStatus::Repaid).await?;

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
        offer_id: Uuid,
        txid: Txid,
        block_height: u64,
    ) -> anyhow::Result<()> {
        spend_offer_utxo(sql_tx, old_outpoint, block_height, txid).await?;
        self.cache.remove(old_outpoint);

        update_offer_status(sql_tx, offer_id, OfferStatus::Liquidated).await?;

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
        offer_id: Uuid,
        txid: Txid,
        block_height: u64,
    ) -> anyhow::Result<()> {
        spend_offer_utxo(sql_tx, old_outpoint, block_height, txid).await?;
        self.cache.remove(old_outpoint);

        update_offer_status(sql_tx, offer_id, OfferStatus::Claimed).await?;

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

    fn is_loan_repayment_tx(tx: &Transaction) -> bool {
        if tx.output.len() < 5 {
            return false;
        }

        tx.output[0].is_null_data()
            && !tx.output[1].is_null_data()
            && !tx.output[2].is_null_data()
            && !tx.output[3].is_null_data()
    }
}
