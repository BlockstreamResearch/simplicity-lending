use sqlx::PgPool;

use simplex::simplicityhl::elements::hex::ToHex;

use lending_contracts::programs::lending::OfferParameters;

use crate::api::OfferListQuery;
use crate::api::db::{AssetSumRow, asset_amounts_from_rows};
use crate::models::{
    OfferModel, OfferParticipantModel, OfferRepaymentModel, OfferStatus, OfferUtxoModel,
    OfferVaultModel, OfferVaultWithdrawalModel, ParticipantType, UtxoType, VaultType,
};

use super::dto::{
    OfferDetailsResponse, OfferListItemFull, OfferListResponse, OfferRepaymentDto, OfferUtxoDto,
    OfferVaultDto, OfferVaultWithdrawalDto, OffersOverview, ParticipantDto,
    borrower_principal_outpoint_from_utxos,
};
use super::list_query::fetch_all_offers_list;

const OPEN_COLLATERAL_STATUSES: [OfferStatus; 2] = [OfferStatus::Pending, OfferStatus::Active];

#[tracing::instrument(name = "Fetching offers overview from DB", skip(db))]
pub async fn fetch_overview(db: &PgPool) -> Result<OffersOverview, sqlx::Error> {
    let (collateral_rows, principal_rows, active_loans_count) = tokio::try_join!(
        sqlx::query_as::<_, AssetSumRow>(
            r#"
            SELECT collateral_asset_id AS asset_id, SUM(collateral_remaining)::BIGINT AS amount
            FROM offers
            WHERE current_status = ANY($1)
            GROUP BY collateral_asset_id
            "#,
        )
        .bind(OPEN_COLLATERAL_STATUSES)
        .fetch_all(db),
        sqlx::query_as::<_, AssetSumRow>(
            r#"
            SELECT principal_asset_id AS asset_id, SUM(current_debt)::BIGINT AS amount
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

async fn fetch_offer_model_by_id(
    db: &PgPool,
    offer_id: i64,
) -> Result<Option<OfferModel>, sqlx::Error> {
    sqlx::query_as!(
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
            current_debt,
            collateral_remaining,
            interest_rate,
            loan_expiration_time,
            updated_at_height,
            created_at_height,
            created_at_txid
        FROM offers
        WHERE id = $1
        "#,
        offer_id,
    )
    .fetch_optional(db)
    .await
}

async fn fetch_latest_participants(
    db: &PgPool,
    offer_id: i64,
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

async fn fetch_unspent_utxos(db: &PgPool, offer_id: i64) -> Result<Vec<OfferUtxoDto>, sqlx::Error> {
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

async fn fetch_offer_repayments(
    db: &PgPool,
    offer_id: i64,
    offer_parameters: &OfferParameters,
) -> Result<Vec<OfferRepaymentDto>, sqlx::Error> {
    let rows = sqlx::query_as!(
        OfferRepaymentModel,
        r#"
        SELECT
            id,
            offer_id,
            txid,
            height,
            amount_repaid,
            collateral_unlocked,
            debt_before,
            debt_after,
            collateral_before,
            collateral_after,
            is_full
        FROM offer_repayments
        WHERE offer_id = $1
        ORDER BY height DESC, id DESC
        "#,
        offer_id,
    )
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| OfferRepaymentDto::from_model(row, offer_parameters))
        .collect())
}

async fn fetch_active_vaults(
    db: &PgPool,
    offer_id: i64,
) -> Result<Vec<OfferVaultDto>, sqlx::Error> {
    let rows = sqlx::query_as!(
        OfferVaultModel,
        r#"
        SELECT
            id,
            offer_id,
            vault_type AS "vault_type: VaultType",
            txid,
            vout,
            amount,
            already_supplied,
            is_finalized,
            created_at_height,
            updated_at_height,
            spent_txid,
            spent_at_height
        FROM offer_vaults
        WHERE offer_id = $1
          AND spent_txid IS NULL
        ORDER BY vault_type ASC, created_at_height ASC
        "#,
        offer_id,
    )
    .fetch_all(db)
    .await?;

    Ok(rows.into_iter().map(OfferVaultDto::from).collect())
}

async fn fetch_offer_vault_withdrawals(
    db: &PgPool,
    offer_id: i64,
) -> Result<Vec<OfferVaultWithdrawalDto>, sqlx::Error> {
    let rows = sqlx::query_as!(
        OfferVaultWithdrawalModel,
        r#"
        SELECT
            id,
            offer_id,
            vault_type AS "vault_type: VaultType",
            txid,
            height,
            is_full,
            amount_withdrawn,
            vault_amount_before,
            vault_amount_after
        FROM offer_vault_withdrawals
        WHERE offer_id = $1
        ORDER BY height DESC, id DESC
        "#,
        offer_id,
    )
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(OfferVaultWithdrawalDto::from)
        .collect())
}

#[tracing::instrument(
    name = "Fetching offer details from DB",
    skip(db, offer_id),
    fields(%offer_id)
)]
pub async fn fetch_details_by_id(
    db: &PgPool,
    offer_id: i64,
) -> Result<Option<OfferDetailsResponse>, sqlx::Error> {
    let Some(model) = fetch_offer_model_by_id(db, offer_id).await? else {
        return Ok(None);
    };

    let offer_parameters = model.offer_parameters();
    let info = OfferListItemFull::from(model);

    let (participants, utxos, vaults, repayments, withdrawals) = tokio::try_join!(
        fetch_latest_participants(db, offer_id),
        fetch_unspent_utxos(db, offer_id),
        fetch_active_vaults(db, offer_id),
        fetch_offer_repayments(db, offer_id, &offer_parameters),
        fetch_offer_vault_withdrawals(db, offer_id),
    )?;

    let mut info = info;
    info.base.borrower_principal_utxo = borrower_principal_outpoint_from_utxos(&utxos);

    Ok(Some(OfferDetailsResponse {
        info,
        participants,
        utxos,
        vaults,
        repayments,
        withdrawals,
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
) -> Result<Vec<i64>, sqlx::Error> {
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
