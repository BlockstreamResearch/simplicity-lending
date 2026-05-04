use uuid::Uuid;

use simplex::simplicityhl::elements::{OutPoint, Transaction, Txid, hashes::Hash};

use crate::indexer::{cache::UtxoCache, db};
use crate::models::{OfferUtxoModel, UtxoType};
use crate::{db::DbTx, models::OfferStatus};

#[tracing::instrument(
    name = "Handling offer liquidation",
    skip(sql_tx, cache, old_outpoint, offer_id, txid, block_height),
    fields(%offer_id, %txid, %block_height),
)]
pub async fn handle_loan_liquidation(
    sql_tx: &mut DbTx<'_>,
    cache: &mut UtxoCache,
    old_outpoint: &OutPoint,
    offer_id: Uuid,
    txid: Txid,
    block_height: u64,
) -> anyhow::Result<()> {
    db::spend_offer_utxo(sql_tx, old_outpoint, block_height, txid).await?;
    cache.remove(old_outpoint);

    db::update_offer_status(sql_tx, offer_id, OfferStatus::Liquidated).await?;

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

    db::insert_offer_utxo(sql_tx, &repayment_utxo).await?;

    tracing::info!(%offer_id, "Offer archived");
    Ok(())
}

pub fn is_loan_liquidation_tx(tx: &Transaction) -> bool {
    if tx.output.len() < 5 {
        return false;
    }

    tx.output[1].is_null_data()
        && tx.output[2].is_null_data()
        && tx.output[3].is_null_data()
        && !tx.output[4].is_null_data()
}

#[cfg(test)]
mod tests {
    use super::is_loan_liquidation_tx;
    use crate::indexer::handlers::test_utils::{make_tx, normal_output, null_output};

    #[test]
    fn valid_liquidation_tx_returns_true() {
        let tx = make_tx(vec![
            normal_output(),
            null_output(),
            null_output(),
            null_output(),
            normal_output(),
        ]);

        assert!(is_loan_liquidation_tx(&tx));
    }

    #[test]
    fn output_1_not_null_data_returns_false() {
        let tx = make_tx(vec![
            normal_output(),
            normal_output(),
            null_output(),
            null_output(),
            normal_output(),
        ]);

        assert!(!is_loan_liquidation_tx(&tx));
    }

    #[test]
    fn output_2_not_null_data_returns_false() {
        let tx = make_tx(vec![
            normal_output(),
            null_output(),
            normal_output(),
            null_output(),
            normal_output(),
        ]);

        assert!(!is_loan_liquidation_tx(&tx));
    }

    #[test]
    fn output_3_not_null_data_returns_false() {
        let tx = make_tx(vec![
            normal_output(),
            null_output(),
            null_output(),
            normal_output(),
            normal_output(),
        ]);

        assert!(!is_loan_liquidation_tx(&tx));
    }

    #[test]
    fn output_4_is_null_data_returns_false() {
        let tx = make_tx(vec![
            normal_output(),
            null_output(),
            null_output(),
            null_output(),
            null_output(),
        ]);

        assert!(!is_loan_liquidation_tx(&tx));
    }

    #[test]
    fn output_0_also_null_data_still_returns_true() {
        let tx = make_tx(vec![
            null_output(),
            null_output(),
            null_output(),
            null_output(),
            normal_output(),
        ]);

        assert!(is_loan_liquidation_tx(&tx));
    }

    #[test]
    fn extra_outputs_beyond_index_4_do_not_affect_result() {
        let tx = make_tx(vec![
            normal_output(),
            null_output(),
            null_output(),
            null_output(),
            normal_output(),
            null_output(),
            normal_output(),
        ]);

        assert!(is_loan_liquidation_tx(&tx));
    }
}
