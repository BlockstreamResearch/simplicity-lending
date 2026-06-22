use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::api::OfferListQuery;
use crate::api::borrowers::dto::AssetAmount;
use crate::api::offers::dto::OfferListResponse;
use crate::api::offers::list_query::fetch_participant_offers_list;
use crate::api::query::attach_latest_participant_offers_scope;
use crate::api::utils::{format_hex, format_satoshis};

use crate::models::{OfferStatus, ParticipantType};

use super::dto::LenderOverview;

#[derive(sqlx::FromRow)]
struct AssetSumRow {
    asset_id: Vec<u8>,
    amount: i64,
}

#[derive(sqlx::FromRow)]
struct LenderCountsRow {
    active_loans: i64,
    to_be_claimed: i64,
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
    name = "Fetching lender overview from DB",
    skip(db, script_pubkey),
    fields(script_pubkey = %hex::encode(script_pubkey))
)]
pub async fn fetch_overview(
    db: &PgPool,
    script_pubkey: &[u8],
) -> Result<LenderOverview, sqlx::Error> {
    let mut supplied_builder: QueryBuilder<Postgres> = QueryBuilder::new(
        r#"
        SELECT principal_asset_id AS asset_id, SUM(principal_amount)::BIGINT AS amount
        FROM offers
        WHERE current_status = "#,
    );
    supplied_builder.push_bind(OfferStatus::Active);
    supplied_builder.push(" AND 1=1");
    attach_latest_participant_offers_scope(
        &mut supplied_builder,
        ParticipantType::Lender,
        script_pubkey,
    );
    supplied_builder.push(" GROUP BY principal_asset_id");

    let supplied_rows = supplied_builder
        .build_query_as::<AssetSumRow>()
        .fetch_all(db)
        .await?;

    let mut interest_builder: QueryBuilder<Postgres> = QueryBuilder::new(
        r#"
        SELECT
            principal_asset_id AS asset_id,
            SUM((principal_amount * interest_rate / 10000))::BIGINT AS amount
        FROM offers
        WHERE current_status = "#,
    );
    interest_builder.push_bind(OfferStatus::Active);
    interest_builder.push(" AND 1=1");
    attach_latest_participant_offers_scope(
        &mut interest_builder,
        ParticipantType::Lender,
        script_pubkey,
    );
    interest_builder.push(" GROUP BY principal_asset_id");

    let interest_rows = interest_builder
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
    counts_builder.push_bind(OfferStatus::Repaid);
    counts_builder.push(
        r#")::BIGINT AS to_be_claimed
        FROM offers
        WHERE 1=1
        "#,
    );
    attach_latest_participant_offers_scope(
        &mut counts_builder,
        ParticipantType::Lender,
        script_pubkey,
    );

    let counts = counts_builder
        .build_query_as::<LenderCountsRow>()
        .fetch_one(db)
        .await?;

    Ok(LenderOverview {
        supplied_loans: asset_amounts_from_rows(supplied_rows),
        interest_outstanding: asset_amounts_from_rows(interest_rows),
        active_loans: counts.active_loans as u64,
        to_be_claimed: counts.to_be_claimed as u64,
    })
}

pub async fn fetch_offer_list(
    db: &PgPool,
    script_pubkey: &[u8],
    query: &OfferListQuery,
) -> Result<OfferListResponse, sqlx::Error> {
    fetch_participant_offers_list(db, query, ParticipantType::Lender, script_pubkey).await
}
