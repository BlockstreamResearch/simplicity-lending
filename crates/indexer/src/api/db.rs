use sqlx::PgPool;
use uuid::Uuid;

use crate::api::Pagination;
use crate::api::dto::{OfferListItemFull, OfferListItemShort, OfferUtxoDto, ParticipantDto};
use crate::models::{
    OfferModel, OfferModelShort, OfferParticipantModel, OfferStatus, OfferUtxoModel,
    ParticipantType, UtxoType,
};

#[tracing::instrument(
    name = "Fetching short offers info list with pagination from DB",
    skip(db, pagination),
    fields(
        limit = %pagination.limit.unwrap_or(50),
        offset = %pagination.offset.unwrap_or(0)
    )
)]
pub async fn fetch_offers_full_info_list(
    db: &PgPool,
    pagination: Pagination,
) -> Result<Vec<OfferListItemFull>, sqlx::Error> {
    let limit = pagination.limit.unwrap_or(50);
    let offset = pagination.offset.unwrap_or(0);

    let rows = sqlx::query_as!(
        OfferModel,
        r#"
        SELECT 
            id,
            current_status AS "current_status: OfferStatus",
            borrower_pubkey,
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
        ORDER BY created_at_height DESC
        LIMIT $1 OFFSET $2
        "#,
        limit,
        offset
    )
    .fetch_all(db)
    .await?;

    let offers = rows.into_iter().map(OfferListItemFull::from).collect();

    Ok(offers)
}

#[tracing::instrument(
    name = "Fetching full offers info list with pagination from DB",
    skip(db, pagination),
    fields(
        limit = %pagination.limit.unwrap_or(50),
        offset = %pagination.offset.unwrap_or(0)
    )
)]
pub async fn fetch_offers_short_info_list(
    db: &PgPool,
    pagination: Pagination,
) -> Result<Vec<OfferListItemShort>, sqlx::Error> {
    let limit = pagination.limit.unwrap_or(50);
    let offset = pagination.offset.unwrap_or(0);

    let rows = sqlx::query_as!(
        OfferModelShort,
        r#"
        SELECT 
            id,
            current_status AS "current_status: OfferStatus",
            collateral_asset_id,
            principal_asset_id,
            collateral_amount,
            principal_amount,
            interest_rate,
            loan_expiration_time,
            created_at_height,
            created_at_txid
        FROM offers
        ORDER BY created_at_height DESC
        LIMIT $1 OFFSET $2
        "#,
        limit,
        offset
    )
    .fetch_all(db)
    .await?;

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
