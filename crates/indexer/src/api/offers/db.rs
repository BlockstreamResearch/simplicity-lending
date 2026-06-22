use sqlx::PgPool;
use uuid::Uuid;

use simplex::simplicityhl::elements::hex::ToHex;

use crate::api::OfferListQuery;
use crate::api::db::{AssetSumRow, asset_amounts_from_rows};
use crate::models::{
    OfferModel, OfferParticipantModel, OfferStatus, OfferUtxoModel, ParticipantType, UtxoType,
};

use super::dto::{
    OfferDetailsResponse, OfferListItemFull, OfferListResponse, OfferUtxoDto, OffersOverview,
    ParticipantDto,
};
use super::list_query::fetch_all_offers_list;

const OPEN_COLLATERAL_STATUSES: [OfferStatus; 2] = [OfferStatus::Pending, OfferStatus::Active];

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
    fetch_all_offers_list(db, &query).await
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
