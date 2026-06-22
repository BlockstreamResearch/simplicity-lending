use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::api::OfferListQuery;
use crate::api::borrowers::dto::AssetAmount;
use crate::api::offers::db::{
    apply_offer_list_filters, enrich_offer_list_items, push_offer_list_order_by,
};
use crate::api::offers::dto::{OfferListItemShort, OfferListResponse};
use crate::api::participants::push_latest_participant_offers_scope;
use crate::api::utils::{format_hex, format_satoshis};

use crate::models::{OfferModelShort, OfferStatus, ParticipantType};

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
    push_latest_participant_offers_scope(
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
    push_latest_participant_offers_scope(
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
    push_latest_participant_offers_scope(
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
    let limit = query.effective_limit();
    let offset = query.effective_offset();

    let mut count_builder: QueryBuilder<Postgres> =
        QueryBuilder::new("SELECT COUNT(*)::BIGINT FROM offers WHERE 1=1");
    push_latest_participant_offers_scope(
        &mut count_builder,
        ParticipantType::Lender,
        script_pubkey,
    );
    apply_offer_list_filters(&mut count_builder, query);
    let total: i64 = count_builder.build_query_scalar().fetch_one(db).await?;

    let mut query_builder: QueryBuilder<Postgres> = QueryBuilder::new(
        r#"
        SELECT
            id,
            issuance_factory_id,
            current_status,
            collateral_asset_id,
            principal_asset_id,
            collateral_amount,
            principal_amount,
            interest_rate,
            loan_expiration_time,
            created_at_height,
            created_at_txid
        FROM offers
        WHERE 1=1
        "#,
    );
    push_latest_participant_offers_scope(
        &mut query_builder,
        ParticipantType::Lender,
        script_pubkey,
    );
    apply_offer_list_filters(&mut query_builder, query);
    push_offer_list_order_by(&mut query_builder, query);
    query_builder.push(" LIMIT ");
    query_builder.push_bind(limit as i64);
    query_builder.push(" OFFSET ");
    query_builder.push_bind(offset as i64);

    let rows = query_builder
        .build_query_as::<OfferModelShort>()
        .fetch_all(db)
        .await?;

    let mut items: Vec<OfferListItemShort> =
        rows.into_iter().map(OfferListItemShort::from).collect();
    enrich_offer_list_items(db, &mut items).await?;

    Ok(OfferListResponse {
        items,
        total: total as u64,
        limit,
        offset,
    })
}
