use crate::{db::DbTx, models::OfferModel};

#[tracing::instrument(
    name = "Inserting offer into DB",
    skip(sql_tx, offer),
    fields(created_at_height = %offer.created_at_height)
)]
pub async fn insert_offer(
    sql_tx: &mut DbTx<'_>,
    offer: &OfferModel,
) -> Result<Option<i64>, sqlx::Error> {
    let row = sqlx::query!(
        r#"
        INSERT INTO offers (
            issuance_factory_id, collateral_asset_id, principal_asset_id,
            borrower_nft_asset_id, lender_nft_asset_id, protocol_fee_keeper_asset_id,
            collateral_amount, principal_amount, current_debt, collateral_remaining,
            interest_rate, loan_expiration_time, updated_at_height, created_at_height,
            created_at_txid
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (created_at_txid) DO NOTHING
        RETURNING id
        "#,
        offer.issuance_factory_id,
        offer.collateral_asset_id,
        offer.principal_asset_id,
        offer.borrower_nft_asset_id,
        offer.lender_nft_asset_id,
        offer.protocol_fee_keeper_asset_id,
        offer.collateral_amount,
        offer.principal_amount,
        offer.current_debt,
        offer.collateral_remaining,
        offer.interest_rate,
        offer.loan_expiration_time,
        offer.updated_at_height,
        offer.created_at_height,
        offer.created_at_txid,
    )
    .fetch_optional(&mut **sql_tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to insert offer to the DB: {e:?}");
        e
    })?;

    Ok(row.map(|r| r.id))
}
