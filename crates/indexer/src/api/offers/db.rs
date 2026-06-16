use simplex::simplicityhl::elements::hex::ToHex;
use sqlx::{PgPool, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::api::utils::parse_filter_hex;
use crate::api::{OfferListQuery, SortDir};
use crate::models::{
    OfferModel, OfferModelShort, OfferParticipantModel, OfferStatus, OfferUtxoModel,
    ParticipantType, UtxoType,
};

use super::dto::{
    OfferDetailsResponse, OfferListItemFull, OfferListItemShort, OfferListResponse, OfferUtxoDto,
    ParticipantDto,
};

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

    let items = rows.into_iter().map(OfferListItemShort::from).collect();

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
