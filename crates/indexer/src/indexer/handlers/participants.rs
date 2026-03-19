use uuid::Uuid;

use simplicityhl::elements::hashes::Hash;
use simplicityhl::elements::{OutPoint, Transaction};

use crate::indexer::{cache::UtxoCache, db};
use crate::models::{OfferParticipantModel, ParticipantType, UtxoData};
use crate::{db::DbTx, models::ActiveUtxo};

#[tracing::instrument(
    name = "Handling offer participant movement",
    skip(sql_tx, tx, cache, old_outpoint, offer_id, participant_type),
    fields(
        %offer_id,
        ?participant_type,
        out_point = %old_outpoint,
        txid = %tx.txid()
    ),
)]
pub async fn handle_participant_movement(
    sql_tx: &mut DbTx<'_>,
    tx: &Transaction,
    cache: &mut UtxoCache,
    old_outpoint: &OutPoint,
    offer_id: Uuid,
    participant_type: ParticipantType,
    block_height: u64,
) -> anyhow::Result<()> {
    let txid = tx.txid();

    let target_asset_id =
        db::get_offer_participant_asset_id(sql_tx, offer_id, participant_type).await?;

    db::spend_participant_utxo(sql_tx, old_outpoint, block_height, txid).await?;
    cache.remove(old_outpoint);

    let found_output = tx.output.iter().enumerate().find_map(|(vout, output)| {
        if let Some(asset) = output.asset.explicit()
            && asset.into_inner().0.to_vec() == target_asset_id
        {
            return Some((vout as u32, &output.script_pubkey));
        }
        None
    });

    if let Some((vout, script_pubkey)) = found_output {
        if script_pubkey.is_op_return() {
            tracing::info!(
                %offer_id,
                ?participant_type,
                "NFT sent to OP_RETURN. Marking as burned and NOT inserting new record."
            );

            return Ok(());
        }

        let new_outpoint = OutPoint { txid, vout };

        let new_participant = OfferParticipantModel {
            offer_id,
            participant_type,
            script_pubkey: script_pubkey.to_bytes(),
            txid: txid.to_byte_array().to_vec(),
            vout: vout as i32,
            created_at_height: block_height as i64,
            spent_txid: None,
            spent_at_height: None,
        };

        db::insert_participant_utxo(sql_tx, &new_participant).await?;

        cache.insert(
            new_outpoint,
            ActiveUtxo {
                offer_id,
                data: UtxoData::Participant(participant_type),
            },
        );

        tracing::info!(%offer_id, ?participant_type, vout, "NFT moved to new location");
    } else {
        tracing::info!(%offer_id, ?participant_type, "NFT was not found in outputs (burned)");
    }

    Ok(())
}
