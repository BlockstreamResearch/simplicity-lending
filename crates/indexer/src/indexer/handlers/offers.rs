use simplex::simplicityhl::elements::{OutPoint, Transaction, hex::ToHex};
use uuid::Uuid;

use crate::indexer::handlers::{handle_lending_creation, handle_offer_cancellation};
use crate::indexer::{
    cache::UtxoCache, handle_loan_liquidation, handle_loan_repayment, handle_repayment_claim,
    is_loan_repayment_tx,
};
use crate::models::UtxoType;
use crate::{db::DbTx, indexer::is_offer_cancellation_tx};

#[tracing::instrument(
    name = "Handling offer status transition",
    skip(sql_tx, tx, cache, old_outpoint, offer_id, utxo_type),
    fields(out_point = %old_outpoint, txid = %tx.txid().to_hex()),
)]
pub async fn handle_offer_transition(
    sql_tx: &mut DbTx<'_>,
    tx: &Transaction,
    cache: &mut UtxoCache,
    old_outpoint: &OutPoint,
    offer_id: Uuid,
    utxo_type: UtxoType,
    block_height: u64,
) -> anyhow::Result<()> {
    match utxo_type {
        UtxoType::PreLock => {
            if is_offer_cancellation_tx(tx) {
                handle_offer_cancellation(
                    sql_tx,
                    cache,
                    old_outpoint,
                    offer_id,
                    tx.txid(),
                    block_height,
                )
                .await
            } else {
                handle_lending_creation(
                    sql_tx,
                    cache,
                    old_outpoint,
                    offer_id,
                    tx.txid(),
                    block_height,
                )
                .await
            }
        }
        UtxoType::Lending => {
            if is_loan_repayment_tx(tx) {
                handle_loan_repayment(
                    sql_tx,
                    cache,
                    old_outpoint,
                    offer_id,
                    tx.txid(),
                    block_height,
                )
                .await
            } else {
                handle_loan_liquidation(
                    sql_tx,
                    cache,
                    old_outpoint,
                    offer_id,
                    tx.txid(),
                    block_height,
                )
                .await
            }
        }
        UtxoType::Repayment => {
            handle_repayment_claim(
                sql_tx,
                cache,
                old_outpoint,
                offer_id,
                tx.txid(),
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
