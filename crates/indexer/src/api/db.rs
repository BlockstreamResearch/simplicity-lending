use std::collections::HashMap;

use simplex::simplicityhl::elements::hex::ToHex;
use sqlx::{PgPool, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::api::OfferFilters;
use crate::api::dto::{
    OfferDetailsResponse, OfferListItemFull, OfferListItemShort, OfferUtxoDto, ParticipantDto,
};
use crate::models::{
    OfferModel, OfferModelShort, OfferParticipantModel, OfferStatus, OfferUtxoModel,
    ParticipantType, UtxoType,
};

#[tracing::instrument(
    name = "Fetching full offers info list with filters from DB",
    skip(db, filters),
    fields(
        limit = %filters.limit.unwrap_or(50),
        offset = %filters.offset.unwrap_or(0),
        status = ?filters.status,
        asset = filters.asset
    )
)]
pub async fn fetch_offers_full_info_filtered(
    db: &PgPool,
    filters: OfferFilters,
) -> Result<Vec<OfferListItemFull>, sqlx::Error> {
    let mut query_builder: QueryBuilder<Postgres> = QueryBuilder::new(
        r#"
            SELECT id, current_status, borrower_pubkey, collateral_asset_id, principal_asset_id, 
            first_parameters_nft_asset_id, second_parameters_nft_asset_id, borrower_nft_asset_id, 
            lender_nft_asset_id, collateral_amount, principal_amount, interest_rate, 
            loan_expiration_time, created_at_height, created_at_txid FROM offers WHERE 1=1 
        "#,
    );

    if let Some(status) = filters.status {
        query_builder.push(" AND current_status = ");
        query_builder.push_bind(status);
    }

    if let Some(asset_hex) = filters.asset {
        if let Ok(bin) = hex::decode(&asset_hex) {
            query_builder.push(" AND (collateral_asset_id = ");
            query_builder.push_bind(bin.clone());
            query_builder.push(" OR principal_asset_id = ");
            query_builder.push_bind(bin);
            query_builder.push(")");
        } else {
            tracing::warn!(asset_hex, "Failed to decode asset hex filter");
        }
    }

    query_builder.push(" ORDER BY created_at_height DESC ");

    query_builder.push(" LIMIT ");
    query_builder.push_bind(filters.limit.unwrap_or(50) as i64);

    query_builder.push(" OFFSET ");
    query_builder.push_bind(filters.offset.unwrap_or(0) as i64);

    let query = query_builder.build_query_as::<OfferModel>();
    let rows = query.fetch_all(db).await?;

    let offers = rows.into_iter().map(OfferListItemFull::from).collect();

    Ok(offers)
}

#[tracing::instrument(
    name = "Fetching short offers info list with filters from DB",
    skip(db, filters),
    fields(
        limit = %filters.limit.unwrap_or(50),
        offset = %filters.offset.unwrap_or(0),
        status = ?filters.status,
        asset = filters.asset
    )
)]
pub async fn fetch_offers_short_info_filtered(
    db: &PgPool,
    filters: OfferFilters,
) -> Result<Vec<OfferListItemShort>, sqlx::Error> {
    let mut query_builder: QueryBuilder<Postgres> = QueryBuilder::new(
        r#"
            SELECT id, current_status, collateral_asset_id, principal_asset_id, 
            collateral_amount, principal_amount, interest_rate, 
            loan_expiration_time, created_at_height, created_at_txid FROM offers WHERE 1=1 
        "#,
    );

    if let Some(status) = filters.status {
        query_builder.push(" AND current_status = ");
        query_builder.push_bind(status);
    }

    if let Some(asset_hex) = filters.asset {
        if let Ok(bin) = hex::decode(&asset_hex) {
            query_builder.push(" AND (collateral_asset_id = ");
            query_builder.push_bind(bin.clone());
            query_builder.push(" OR principal_asset_id = ");
            query_builder.push_bind(bin);
            query_builder.push(")");
        } else {
            tracing::warn!(asset_hex, "Failed to decode asset hex filter");
        }
    }

    query_builder.push(" ORDER BY created_at_height DESC ");

    query_builder.push(" LIMIT ");
    query_builder.push_bind(filters.limit.unwrap_or(50) as i64);

    query_builder.push(" OFFSET ");
    query_builder.push_bind(filters.offset.unwrap_or(0) as i64);

    let query = query_builder.build_query_as::<OfferModelShort>();
    let rows = query.fetch_all(db).await?;

    let offers = rows.into_iter().map(OfferListItemShort::from).collect();

    Ok(offers)
}

#[tracing::instrument(
    name = "Fetching offer full info from DB",
    skip(db, offer_id),
    fields(%offer_id)
)]
pub async fn fetch_offer_full_info_by_id(
    db: &PgPool,
    offer_id: Uuid,
) -> Result<Option<OfferListItemFull>, sqlx::Error> {
    let model = sqlx::query_as!(
        OfferModel,
        r#"
        SELECT 
            id,
            current_status AS "current_status: OfferStatus",
            borrower_pubkey,
            borrower_output_script_hash,
            collateral_asset_id,
            principal_asset_id,
            first_parameters_nft_asset_id,
            second_parameters_nft_asset_id,
            borrower_nft_asset_id,
            lender_nft_asset_id,
            collateral_amount,
            principal_amount,
            interest_rate,
            loan_expiration_time,
            created_at_height,
            created_at_txid
        FROM offers
        WHERE id = $1
        "#,
        offer_id
    )
    .fetch_optional(db)
    .await?;

    Ok(model.map(OfferListItemFull::from))
}

#[tracing::instrument(
    name = "Fetching offer details by ids from DB",
    skip(db, ids),
    fields(
        ids_count = %ids.len(),
    )
)]
pub async fn fetch_offer_details_by_ids(
    db: &PgPool,
    ids: &[Uuid],
) -> Result<Vec<OfferDetailsResponse>, sqlx::Error> {
    if ids.is_empty() {
        return Ok(vec![]);
    }

    let offers = sqlx::query_as!(
        OfferModel,
        r#"
        SELECT 
            id, current_status AS "current_status: OfferStatus",
            borrower_pubkey, borrower_output_script_hash, collateral_asset_id, principal_asset_id,
            first_parameters_nft_asset_id, second_parameters_nft_asset_id,
            borrower_nft_asset_id, lender_nft_asset_id,
            collateral_amount, principal_amount, interest_rate,
            loan_expiration_time, created_at_height, created_at_txid
        FROM offers
        WHERE id = ANY($1)
        "#,
        ids
    )
    .fetch_all(db)
    .await?;

    let participants = sqlx::query_as!(
        OfferParticipantModel,
        r#"
        SELECT DISTINCT ON (offer_id, participant_type)
            offer_id, participant_type AS "participant_type: ParticipantType",
            script_pubkey, txid, vout, created_at_height, spent_txid, spent_at_height
        FROM offer_participants
        WHERE offer_id = ANY($1)
        ORDER BY offer_id, participant_type, created_at_height DESC
        "#,
        ids
    )
    .fetch_all(db)
    .await?;

    let mut participants_map: HashMap<Uuid, Vec<ParticipantDto>> = HashMap::new();

    for p_model in participants {
        participants_map
            .entry(p_model.offer_id)
            .or_default()
            .push(ParticipantDto::from(p_model));
    }

    let result = offers
        .into_iter()
        .map(|o_model| {
            let id = o_model.id;
            OfferDetailsResponse {
                info: OfferListItemFull::from(o_model),
                participants: participants_map.remove(&id).unwrap_or_default(),
            }
        })
        .collect();

    Ok(result)
}

#[tracing::instrument(
    name = "Fetching offer participants movement history from DB",
    skip(db, offer_id),
    fields(%offer_id)
)]
pub async fn fetch_offer_participants_history(
    db: &PgPool,
    offer_id: Uuid,
) -> Result<Vec<ParticipantDto>, sqlx::Error> {
    let rows = sqlx::query_as!(
        OfferParticipantModel,
        r#"
        SELECT
            offer_id,
            participant_type as "participant_type: ParticipantType",
            script_pubkey,
            txid,
            vout,
            created_at_height,
            spent_txid,
            spent_at_height
        FROM offer_participants
        WHERE offer_id = $1
        "#,
        offer_id
    )
    .fetch_all(db)
    .await?;

    let participants = rows.into_iter().map(ParticipantDto::from).collect();

    Ok(participants)
}

#[tracing::instrument(
    name = "Fetching latest offer participants from DB",
    skip(db, offer_id),
    fields(%offer_id)
)]
pub async fn fetch_latest_participants(
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
        offer_id
    )
    .fetch_all(db)
    .await?;

    let participants = rows.into_iter().map(ParticipantDto::from).collect();

    Ok(participants)
}

#[tracing::instrument(
    name = "Fetching offer ids by script from DB",
    skip(db, script_pubkey),
    fields(script_pubkey = %script_pubkey.to_hex())
)]
pub async fn fetch_offer_ids_by_script(
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

    let offer_ids = rows.into_iter().map(|r| r.offer_id).collect();

    Ok(offer_ids)
}

#[tracing::instrument(
    name = "Fetching pending offer ids by borrower pubkey from DB",
    skip(db, borrower_pubkey),
    fields(borrower_pubkey = %borrower_pubkey.to_hex())
)]
pub async fn fetch_pending_offer_ids_by_borrower_pubkey(
    db: &PgPool,
    borrower_pubkey: &[u8],
) -> Result<Vec<Uuid>, sqlx::Error> {
    let rows = sqlx::query!(
        r#"
        SELECT id
        FROM offers
        WHERE borrower_pubkey = $1
          AND current_status = 'pending'
        "#,
        borrower_pubkey
    )
    .fetch_all(db)
    .await?;

    let offer_ids = rows.into_iter().map(|r| r.id).collect();

    Ok(offer_ids)
}

#[tracing::instrument(
    name = "Fetching offer utxos history from DB",
    skip(db, offer_id),
    fields(%offer_id)
)]
pub async fn fetch_offer_utxos_history(
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
            utxo_type as "utxo_type: UtxoType",
            created_at_height,
            spent_txid,
            spent_at_height
        FROM offer_utxos
        WHERE offer_id = $1
        ORDER BY created_at_height ASC
        "#,
        offer_id
    )
    .fetch_all(db)
    .await?;

    let offer_utxos = rows.into_iter().map(OfferUtxoDto::from).collect();

    Ok(offer_utxos)
}
