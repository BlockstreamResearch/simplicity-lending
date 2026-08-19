use sqlx::PgPool;

use simplex::{
    provider::SimplicityNetwork,
    simplicityhl::elements::{OutPoint, Txid, hashes::Hash, hex::ToHex},
};

use crate::{
    api::utils::{format_hex, format_offer_id, format_satoshis},
    db::DbTx,
    events::{IndexerEvent, notify_indexer_event},
    indexer::{OffersWatchEntry, WatchCache},
    models::{OfferModel, OfferRepaymentModel, OfferStatus, OfferUtxoModel, UtxoType},
};
use lending_contracts::programs::lending::LendingOfferParameters;

#[tracing::instrument(name = "Loading all active offer UTXOs from DB", skip(db))]
pub async fn load_offer_utxos_cache(db: &PgPool) -> anyhow::Result<WatchCache<OffersWatchEntry>> {
    let offer_rows = sqlx::query_as!(
        OfferUtxoModel,
        r#"
        SELECT 
            offer_id, 
            txid, 
            vout, 
            utxo_type AS "utxo_type: UtxoType", 
            created_at_height, 
            spent_txid, 
            spent_at_height
        FROM offer_utxos 
        WHERE spent_txid IS NULL
        "#
    )
    .fetch_all(db)
    .await
    .map_err(|e| {
        tracing::error!("Failed to load active offer UTXOs from DB: {e:?}");
        e
    })?;

    let offers_count = offer_rows.len();

    let mut cache = WatchCache::with_capacity(offers_count);

    for rec in offer_rows {
        let outpoint = OutPoint {
            txid: Txid::from_slice(&rec.txid)?,
            vout: rec.vout as u32,
        };
        cache.insert(
            outpoint,
            OffersWatchEntry {
                offer_id: rec.offer_id,
                utxo_type: rec.utxo_type,
            },
        );
    }

    tracing::info!(
        offers = offers_count,
        "Warm-up: Offers WatchCache populated"
    );

    Ok(cache)
}

#[tracing::instrument(
    name = "Marking offer UTXO as spent in DB",
    skip(sql_tx, outpoint, block_height, txid),
    fields(
        spent_txid = %txid.to_hex(),
        txid = %outpoint.txid.to_hex(),
        vout = %outpoint.vout
    )
)]
pub async fn spend_offer_utxo(
    sql_tx: &mut DbTx<'_>,
    outpoint: &OutPoint,
    block_height: u64,
    txid: Txid,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE offer_utxos SET spent_txid = $1, spent_at_height = $2 WHERE txid = $3 AND vout = $4
        "#,
        txid.as_byte_array(),
        block_height as i64,
        outpoint.txid.as_byte_array(),
        outpoint.vout as i32
    )
    .execute(&mut **sql_tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to mark offer UTXO as spent: {e:?}");
        e
    })?;

    Ok(())
}

#[tracing::instrument(
    name = "Updating offer status in DB",
    skip(sql_tx),
    fields(offer_id = %offer_id, status = ?new_status, block_height = %block_height)
)]
pub async fn update_offer_status(
    sql_tx: &mut DbTx<'_>,
    offer_id: i64,
    new_status: OfferStatus,
    block_height: u64,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE offers
        SET current_status = $1, updated_at_height = $2
        WHERE id = $3
        "#,
        new_status as OfferStatus,
        block_height as i64,
        offer_id,
    )
    .execute(&mut **sql_tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to update offer status: {e:?}");
        e
    })?;

    notify_indexer_event(
        sql_tx,
        &IndexerEvent::OfferStatusUpdated {
            id: offer_id.to_string(),
            status: new_status,
            height: block_height,
        },
    )
    .await?;

    Ok(())
}

#[tracing::instrument(
    name = "Fetching offer by id",
    skip(sql_tx),
    fields(offer_id = %offer_id)
)]
pub async fn fetch_offer(sql_tx: &mut DbTx<'_>, offer_id: i64) -> Result<OfferModel, sqlx::Error> {
    sqlx::query_as!(
        OfferModel,
        r#"
        SELECT
            id,
            issuance_factory_id,
            current_status AS "current_status: OfferStatus",
            collateral_asset_id,
            principal_asset_id,
            borrower_nft_asset_id,
            lender_nft_asset_id,
            protocol_fee_keeper_asset_id,
            collateral_amount,
            principal_amount,
            current_debt,
            collateral_remaining,
            interest_rate,
            loan_expiration_time,
            updated_at_height,
            created_at_height,
            created_at_txid
        FROM offers
        WHERE id = $1
        "#,
        offer_id,
    )
    .fetch_one(&mut **sql_tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to fetch offer: {e:?}");
        e
    })
}

#[tracing::instrument(
    name = "Fetching offer lending parameters",
    skip(sql_tx),
    fields(offer_id = %offer_id)
)]
pub async fn fetch_offer_parameters(
    sql_tx: &mut DbTx<'_>,
    offer_id: i64,
    network: SimplicityNetwork,
) -> anyhow::Result<LendingOfferParameters> {
    let model = fetch_offer(sql_tx, offer_id).await?;

    model.to_lending_offer_parameters(network)
}

#[tracing::instrument(
    name = "Updating offer debt and remaining collateral",
    skip(sql_tx),
    fields(
        offer_id = %offer_id,
        current_debt = %current_debt,
        collateral_remaining = %collateral_remaining,
        block_height = %block_height
    )
)]
pub async fn update_offer_debt_and_collateral(
    sql_tx: &mut DbTx<'_>,
    offer_id: i64,
    current_debt: i64,
    collateral_remaining: i64,
    block_height: u64,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE offers
        SET current_debt = $1,
            collateral_remaining = $2,
            updated_at_height = $3
        WHERE id = $4
        "#,
        current_debt,
        collateral_remaining,
        block_height as i64,
        offer_id,
    )
    .execute(&mut **sql_tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to update offer debt/collateral: {e:?}");
        e
    })?;

    Ok(())
}

#[tracing::instrument(
    name = "Inserting offer repayment history row",
    skip(sql_tx, repayment),
    fields(
        offer_id = %repayment.offer_id,
        height = %repayment.height,
        is_full = %repayment.is_full
    )
)]
pub async fn insert_offer_repayment(
    sql_tx: &mut DbTx<'_>,
    repayment: &OfferRepaymentModel,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO offer_repayments (
            offer_id, txid, height, amount_repaid, collateral_unlocked,
            debt_before, debt_after, collateral_before, collateral_after, is_full
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        "#,
        repayment.offer_id,
        repayment.txid,
        repayment.height,
        repayment.amount_repaid,
        repayment.collateral_unlocked,
        repayment.debt_before,
        repayment.debt_after,
        repayment.collateral_before,
        repayment.collateral_after,
        repayment.is_full,
    )
    .execute(&mut **sql_tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to insert offer repayment: {e:?}");
        e
    })?;

    notify_indexer_event(
        sql_tx,
        &IndexerEvent::OfferRepaymentIndexed {
            id: format_offer_id(repayment.offer_id),
            txid: format_hex(repayment.txid.clone()),
            height: repayment.height as u64,
            amount_repaid: format_satoshis(repayment.amount_repaid),
            debt_after: format_satoshis(repayment.debt_after),
            collateral_after: format_satoshis(repayment.collateral_after),
            is_full: repayment.is_full,
        },
    )
    .await?;

    Ok(())
}

#[tracing::instrument(
    name = "Inserting offer UTXO into DB",
    skip(sql_tx, offer_utxo),
    fields(offer_id = %offer_utxo.offer_id, txid = %offer_utxo.txid.to_hex(), vout = %offer_utxo.vout)
)]
pub async fn insert_offer_utxo(
    sql_tx: &mut DbTx<'_>,
    offer_utxo: &OfferUtxoModel,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO offer_utxos (
            offer_id, txid, vout, utxo_type, created_at_height, spent_txid, spent_at_height
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
        offer_utxo.offer_id,
        offer_utxo.txid,
        offer_utxo.vout,
        offer_utxo.utxo_type as UtxoType,
        offer_utxo.created_at_height,
        offer_utxo.spent_txid,
        offer_utxo.spent_at_height,
    )
    .execute(&mut **sql_tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to insert offer UXTO to the DB: {e:?}");
        e
    })?;

    Ok(())
}
