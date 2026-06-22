use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::api::OfferListQuery;
use crate::api::offers::dto::OfferListResponse;
use crate::api::offers::list_query::fetch_participant_offers_list;
use crate::api::query::{attach_latest_participant_offers_scope, attach_status_any};
use crate::api::utils::{format_hex, format_satoshis};

use crate::models::{OfferStatus, ParticipantType};

use super::dto::{AssetAmount, BorrowerOverview};

const OPEN_BORROWER_STATUSES: [OfferStatus; 2] = [OfferStatus::Pending, OfferStatus::Active];

#[derive(sqlx::FromRow)]
struct AssetSumRow {
    asset_id: Vec<u8>,
    amount: i64,
}

#[derive(sqlx::FromRow)]
struct BorrowerCountsRow {
    active_loans: i64,
    pending_offers: i64,
}

fn asset_amounts_from_rows(rows: Vec<AssetSumRow>) -> Vec<AssetAmount> {
    rows.into_iter()
        .map(|row| AssetAmount {
            asset: format_hex(row.asset_id),
            amount: format_satoshis(row.amount),
        })
        .collect()
}

#[tracing::instrument(
    name = "Fetching borrower overview from DB",
    skip(db, script_pubkey),
    fields(script_pubkey = %hex::encode(script_pubkey))
)]
pub async fn fetch_overview(
    db: &PgPool,
    script_pubkey: &[u8],
) -> Result<BorrowerOverview, sqlx::Error> {
    let mut collateral_builder: QueryBuilder<Postgres> = QueryBuilder::new(
        r#"
        SELECT collateral_asset_id AS asset_id, SUM(collateral_amount)::BIGINT AS amount
        FROM offers
        WHERE 1=1
        "#,
    );
    attach_latest_participant_offers_scope(
        &mut collateral_builder,
        ParticipantType::Borrower,
        script_pubkey,
    );
    attach_status_any(&mut collateral_builder, &OPEN_BORROWER_STATUSES);
    collateral_builder.push(" GROUP BY collateral_asset_id");

    let collateral_rows = collateral_builder
        .build_query_as::<AssetSumRow>()
        .fetch_all(db)
        .await?;

    let mut borrowings_builder: QueryBuilder<Postgres> = QueryBuilder::new(
        r#"
        SELECT principal_asset_id AS asset_id, SUM(principal_amount)::BIGINT AS amount
        FROM offers
        WHERE 1=1
        "#,
    );
    attach_latest_participant_offers_scope(
        &mut borrowings_builder,
        ParticipantType::Borrower,
        script_pubkey,
    );
    attach_status_any(&mut borrowings_builder, &OPEN_BORROWER_STATUSES);
    borrowings_builder.push(" GROUP BY principal_asset_id");

    let borrowings_rows = borrowings_builder
        .build_query_as::<AssetSumRow>()
        .fetch_all(db)
        .await?;

    let mut counts_builder: QueryBuilder<Postgres> = QueryBuilder::new(
        r#"
        SELECT
            COUNT(*) FILTER (WHERE current_status = "#,
    );
    counts_builder.push_bind(OfferStatus::Active);
    counts_builder.push(
        r#")::BIGINT AS active_loans,
            COUNT(*) FILTER (WHERE current_status = "#,
    );
    counts_builder.push_bind(OfferStatus::Pending);
    counts_builder.push(
        r#")::BIGINT AS pending_offers
        FROM offers
        WHERE 1=1
        "#,
    );
    attach_latest_participant_offers_scope(
        &mut counts_builder,
        ParticipantType::Borrower,
        script_pubkey,
    );

    let counts = counts_builder
        .build_query_as::<BorrowerCountsRow>()
        .fetch_one(db)
        .await?;

    Ok(BorrowerOverview {
        collateral_locked: asset_amounts_from_rows(collateral_rows),
        borrowings: asset_amounts_from_rows(borrowings_rows),
        active_loans: counts.active_loans as u64,
        pending_offers: counts.pending_offers as u64,
    })
}

pub async fn fetch_offer_list(
    db: &PgPool,
    script_pubkey: &[u8],
    query: &OfferListQuery,
) -> Result<OfferListResponse, sqlx::Error> {
    fetch_participant_offers_list(db, query, ParticipantType::Borrower, script_pubkey).await
}
