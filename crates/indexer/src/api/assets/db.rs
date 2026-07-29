use simplex::simplicityhl::elements::hex::ToHex;

use sqlx::PgPool;

/// Whether `asset_id` belongs to an indexed protocol asset (a factory asset or an offer NFT).
#[tracing::instrument(
    name = "Checking protocol asset in DB",
    skip(db, asset_id),
    fields(asset_id = %asset_id.to_hex())
)]
pub async fn is_known_protocol_asset(db: &PgPool, asset_id: &[u8]) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar!(
        r#"SELECT EXISTS(
            SELECT 1 FROM factories WHERE factory_asset_id = $1
            UNION ALL
            SELECT 1 FROM offers
            WHERE borrower_nft_asset_id = $1 OR lender_nft_asset_id = $1
        ) AS "known!""#,
        asset_id,
    )
    .fetch_one(db)
    .await
}
