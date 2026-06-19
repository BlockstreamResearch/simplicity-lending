use simplex::simplicityhl::elements::hex::ToHex;
use sqlx::{PgPool, Postgres, QueryBuilder};
use std::collections::HashMap;
use uuid::Uuid;

use crate::api::utils::{format_hex, format_satoshis, parse_filter_hex};
use crate::api::{OfferListQuery, SortDir};
use crate::models::{
    OfferModel, OfferModelShort, OfferParticipantModel, OfferStatus, OfferUtxoModel,
    ParticipantType, UtxoType,
};

use super::dto::{
    OfferDetailsResponse, OfferListItemFull, OfferListItemShort, OfferListResponse, OfferUtxoDto,
    OfferUtxoOutpointShort, OffersOverview, ParticipantDto, ParticipantShort,
};

use crate::api::borrowers::dto::AssetAmount;

#[derive(sqlx::FromRow)]
struct AssetSumRow {
    asset_id: Vec<u8>,
    amount: i64,
}

fn asset_amounts_from_rows(rows: Vec<AssetSumRow>) -> Vec<AssetAmount> {
    rows.into_iter()
        .map(|row| AssetAmount {
            asset: format_hex(row.asset_id),
            amount: format_satoshis(row.amount),
        })
        .collect()
}

const OPEN_COLLATERAL_STATUSES: [OfferStatus; 2] = [OfferStatus::Pending, OfferStatus::Active];

#[derive(sqlx::FromRow)]
struct ParticipantListRow {
    offer_id: Uuid,
    participant_type: ParticipantType,
    script_pubkey: Vec<u8>,
}

#[derive(sqlx::FromRow)]
struct BorrowerPrincipalListRow {
    offer_id: Uuid,
    txid: Vec<u8>,
    vout: i32,
}

pub(crate) async fn enrich_offer_list_items(
    db: &PgPool,
    items: &mut [OfferListItemShort],
) -> Result<(), sqlx::Error> {
    if items.is_empty() {
        return Ok(());
    }

    let offer_ids: Vec<Uuid> = items.iter().map(|item| item.id).collect();

    let participant_rows = sqlx::query_as::<_, ParticipantListRow>(
        r#"
        SELECT DISTINCT ON (offer_id, participant_type)
            offer_id,
            participant_type,
            script_pubkey
        FROM offer_participants
        WHERE offer_id = ANY($1)
        ORDER BY offer_id, participant_type, created_at_height DESC
        "#,
    )
    .bind(&offer_ids)
    .fetch_all(db)
    .await?;

    let principal_rows = sqlx::query_as::<_, BorrowerPrincipalListRow>(
        r#"
        SELECT offer_id, txid, vout
        FROM offer_utxos
        WHERE spent_txid IS NULL
          AND utxo_type = $1
          AND offer_id = ANY($2)
        "#,
    )
    .bind(UtxoType::BorrowerPrincipal)
    .bind(&offer_ids)
    .fetch_all(db)
    .await?;

    let mut participants_by_offer: HashMap<Uuid, Vec<ParticipantShort>> = HashMap::new();
    for row in participant_rows {
        participants_by_offer
            .entry(row.offer_id)
            .or_default()
            .push(ParticipantShort {
                participant_type: row.participant_type,
                script_pubkey: row.script_pubkey.to_hex(),
            });
    }

    for participants in participants_by_offer.values_mut() {
        participants.sort_by_key(|participant| participant.participant_type);
    }

    let mut principal_by_offer: HashMap<Uuid, OfferUtxoOutpointShort> = HashMap::new();
    for row in principal_rows {
        principal_by_offer.insert(
            row.offer_id,
            OfferUtxoOutpointShort {
                txid: format_hex(row.txid),
                vout: row.vout as u32,
            },
        );
    }

    for item in items.iter_mut() {
        item.participants = participants_by_offer.remove(&item.id).unwrap_or_default();
        item.borrower_principal_utxo = principal_by_offer.remove(&item.id);
    }

    Ok(())
}

#[tracing::instrument(name = "Fetching offers overview from DB", skip(db))]
pub async fn fetch_overview(db: &PgPool) -> Result<OffersOverview, sqlx::Error> {
    let (collateral_rows, principal_rows, active_loans_count) = tokio::try_join!(
        sqlx::query_as::<_, AssetSumRow>(
            r#"
            SELECT collateral_asset_id AS asset_id, SUM(collateral_amount)::BIGINT AS amount
            FROM offers
            WHERE current_status = ANY($1)
            GROUP BY collateral_asset_id
            "#,
        )
        .bind(OPEN_COLLATERAL_STATUSES)
        .fetch_all(db),
        sqlx::query_as::<_, AssetSumRow>(
            r#"
            SELECT principal_asset_id AS asset_id, SUM(principal_amount)::BIGINT AS amount
            FROM offers
            WHERE current_status = $1
            GROUP BY principal_asset_id
            "#,
        )
        .bind(OfferStatus::Active)
        .fetch_all(db),
        sqlx::query_scalar::<_, i64>(
            r#"
            SELECT COUNT(*)::BIGINT
            FROM offers
            WHERE current_status = $1
            "#,
        )
        .bind(OfferStatus::Active)
        .fetch_one(db),
    )?;

    Ok(OffersOverview {
        collateral_locked: asset_amounts_from_rows(collateral_rows),
        active_loan_principal: asset_amounts_from_rows(principal_rows),
        active_loans_count: active_loans_count as u64,
    })
}

pub(crate) fn apply_offer_list_filters<'a>(
    query_builder: &mut QueryBuilder<'a, Postgres>,
    query: &'a OfferListQuery,
) {
    if !query.status.is_empty() {
        query_builder.push(" AND current_status = ANY(");
        query_builder.push_bind(query.status.clone());
        query_builder.push(")");
    }

    if let Some(factory_id) = query.factory_id {
        query_builder.push(" AND issuance_factory_id = ");
        query_builder.push_bind(factory_id);
    }

    if let Some(collateral_asset_hex) = &query.collateral_asset {
        if let Some(bin) = parse_filter_hex(collateral_asset_hex) {
            query_builder.push(" AND collateral_asset_id = ");
            query_builder.push_bind(bin);
        } else {
            tracing::warn!(
                collateral_asset_hex,
                "Failed to decode collateral_asset hex filter"
            );
        }
    }

    if let Some(principal_asset_hex) = &query.principal_asset {
        if let Some(bin) = parse_filter_hex(principal_asset_hex) {
            query_builder.push(" AND principal_asset_id = ");
            query_builder.push_bind(bin);
        } else {
            tracing::warn!(
                principal_asset_hex,
                "Failed to decode principal_asset hex filter"
            );
        }
    }
}

pub(crate) fn push_offer_list_order_by(
    query_builder: &mut QueryBuilder<Postgres>,
    query: &OfferListQuery,
) {
    query_builder.push(" ORDER BY ");
    query_builder.push(query.sort_by.sql_column());
    query_builder.push(match query.sort_dir {
        SortDir::Asc => " ASC",
        SortDir::Desc => " DESC",
    });
}

#[tracing::instrument(
    name = "Fetching offers list from DB",
    skip(db, query),
    fields(
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
pub async fn fetch_list(
    db: &PgPool,
    query: OfferListQuery,
) -> Result<OfferListResponse, sqlx::Error> {
    let limit = query.effective_limit();
    let offset = query.effective_offset();

    let mut count_builder: QueryBuilder<Postgres> =
        QueryBuilder::new("SELECT COUNT(*)::BIGINT FROM offers WHERE 1=1");
    apply_offer_list_filters(&mut count_builder, &query);
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

    apply_offer_list_filters(&mut query_builder, &query);
    push_offer_list_order_by(&mut query_builder, &query);

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

async fn fetch_full_info_by_id(
    db: &PgPool,
    offer_id: Uuid,
) -> Result<Option<OfferListItemFull>, sqlx::Error> {
    let model = sqlx::query_as!(
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
            interest_rate,
            loan_expiration_time,
            created_at_height,
            created_at_txid
        FROM offers
        WHERE id = $1
        "#,
        offer_id,
    )
    .fetch_optional(db)
    .await?;

    Ok(model.map(OfferListItemFull::from))
}

async fn fetch_latest_participants(
    db: &PgPool,
    offer_id: Uuid,
) -> Result<Vec<ParticipantDto>, sqlx::Error> {
    let rows = sqlx::query_as!(
        OfferParticipantModel,
        r#"
        SELECT DISTINCT ON (participant_type)
            offer_id,
            participant_type AS "participant_type: ParticipantType",
            script_pubkey,
            txid,
            vout,
            created_at_height,
            spent_txid,
            spent_at_height
        FROM offer_participants
        WHERE offer_id = $1
        ORDER BY participant_type, created_at_height DESC
        "#,
        offer_id,
    )
    .fetch_all(db)
    .await?;

    Ok(rows.into_iter().map(ParticipantDto::from).collect())
}

async fn fetch_unspent_utxos(
    db: &PgPool,
    offer_id: Uuid,
) -> Result<Vec<OfferUtxoDto>, sqlx::Error> {
    let rows = sqlx::query_as!(
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
        WHERE offer_id = $1
          AND spent_txid IS NULL
        ORDER BY created_at_height ASC
        "#,
        offer_id,
    )
    .fetch_all(db)
    .await?;

    Ok(rows.into_iter().map(OfferUtxoDto::from).collect())
}

#[tracing::instrument(
    name = "Fetching offer details from DB",
    skip(db, offer_id),
    fields(%offer_id)
)]
pub async fn fetch_details_by_id(
    db: &PgPool,
    offer_id: Uuid,
) -> Result<Option<OfferDetailsResponse>, sqlx::Error> {
    let Some(info) = fetch_full_info_by_id(db, offer_id).await? else {
        return Ok(None);
    };

    let (participants, utxos) = tokio::try_join!(
        fetch_latest_participants(db, offer_id),
        fetch_unspent_utxos(db, offer_id),
    )?;

    Ok(Some(OfferDetailsResponse {
        info,
        participants,
        utxos,
    }))
}

#[tracing::instrument(
    name = "Fetching offer ids by script from DB",
    skip(db, script_pubkey),
    fields(script_pubkey = %script_pubkey.to_hex())
)]
pub async fn fetch_ids_by_script(
    db: &PgPool,
    script_pubkey: &[u8],
) -> Result<Vec<Uuid>, sqlx::Error> {
    let rows = sqlx::query!(
        r#"
        SELECT DISTINCT offer_id
        FROM offer_participants
        WHERE script_pubkey = $1
          AND spent_txid IS NULL
        "#,
        script_pubkey
    )
    .fetch_all(db)
    .await?;

    Ok(rows.into_iter().map(|row| row.offer_id).collect())
}
