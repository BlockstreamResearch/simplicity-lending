use sqlx::{PgPool, Postgres, QueryBuilder};

use crate::api::OfferListQuery;
use crate::api::offers::db::{apply_offer_list_filters, push_offer_list_order_by};
use crate::api::offers::dto::{OfferListItemShort, OfferListResponse};
use crate::api::utils::{format_hex, format_satoshis};
use crate::models::{OfferModelShort, OfferStatus, ParticipantType};

use super::dto::{AssetAmount, BorrowerDashboardResponse, BorrowerOverview};

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

fn push_borrower_offers_scope<'a>(
    query_builder: &mut QueryBuilder<'a, Postgres>,
    script_pubkey: &'a [u8],
) {
    query_builder.push(" AND id IN (");
    query_builder.push(
        "SELECT offer_id FROM (
            SELECT DISTINCT ON (offer_id) offer_id, script_pubkey
            FROM offer_participants
            WHERE participant_type = ",
    );
    query_builder.push_bind(ParticipantType::Borrower);
    query_builder.push(
        " ORDER BY offer_id, created_at_height DESC
        ) latest_borrower WHERE script_pubkey = ",
    );
    query_builder.push_bind(script_pubkey);
    query_builder.push(")");
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
async fn fetch_overview(
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
    push_borrower_offers_scope(&mut collateral_builder, script_pubkey);
    collateral_builder.push(" AND current_status = ANY(");
    collateral_builder.push_bind(OPEN_BORROWER_STATUSES);
    collateral_builder.push(") GROUP BY collateral_asset_id");

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
    push_borrower_offers_scope(&mut borrowings_builder, script_pubkey);
    borrowings_builder.push(" AND current_status = ANY(");
    borrowings_builder.push_bind(OPEN_BORROWER_STATUSES);
    borrowings_builder.push(") GROUP BY principal_asset_id");

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
    push_borrower_offers_scope(&mut counts_builder, script_pubkey);

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

async fn fetch_offer_list(
    db: &PgPool,
    script_pubkey: &[u8],
    query: &OfferListQuery,
) -> Result<OfferListResponse, sqlx::Error> {
    let limit = query.effective_limit();
    let offset = query.effective_offset();

    let mut count_builder: QueryBuilder<Postgres> =
        QueryBuilder::new("SELECT COUNT(*)::BIGINT FROM offers WHERE 1=1");
    push_borrower_offers_scope(&mut count_builder, script_pubkey);
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
    push_borrower_offers_scope(&mut query_builder, script_pubkey);
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

    let items = rows.into_iter().map(OfferListItemShort::from).collect();

    Ok(OfferListResponse {
        items,
        total: total as u64,
        limit,
        offset,
    })
}

#[tracing::instrument(
    name = "Fetching borrower dashboard from DB",
    skip(db, script_pubkey, query),
    fields(
        script_pubkey = %hex::encode(script_pubkey),
        limit = %query.effective_limit(),
        offset = %query.effective_offset(),
        status = ?query.status,
        collateral_asset = ?query.collateral_asset,
        principal_asset = ?query.principal_asset,
        factory_id = ?query.factory_id,
        sort_by = ?query.sort_by,
        sort_dir = ?query.sort_dir,
    )
)]
pub async fn fetch_dashboard(
    db: &PgPool,
    script_pubkey: &[u8],
    query: OfferListQuery,
) -> Result<BorrowerDashboardResponse, sqlx::Error> {
    let overview = fetch_overview(db, script_pubkey).await?;
    let offers = fetch_offer_list(db, script_pubkey, &query).await?;

    Ok(BorrowerDashboardResponse { overview, offers })
}
