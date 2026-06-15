use simplex::simplicityhl::elements::hex::ToHex;
use sqlx::PgPool;
use uuid::Uuid;

use super::dto::{FactoryDetailsResponse, FactoryDetailsRow};
use crate::models::FactoryStatus;

#[tracing::instrument(
    name = "Fetching factories by script from DB",
    skip(db, script_pubkey),
    fields(script_pubkey = %script_pubkey.to_hex())
)]
pub async fn fetch_by_script(
    db: &PgPool,
    script_pubkey: &[u8],
) -> Result<Vec<FactoryDetailsResponse>, sqlx::Error> {
    let rows = sqlx::query_as!(
        FactoryDetailsRow,
        r#"
        SELECT DISTINCT ON (factory.id)
            factory.id,
            factory.factory_asset_id,
            factory.program_script_pubkey,
            factory.current_status AS "current_status: FactoryStatus",
            factory.issuing_utxos_count,
            factory.reissuance_flags,
            factory.created_at_height,
            factory.created_at_txid,
            factory_auth.txid AS auth_txid,
            factory_auth.vout AS auth_vout,
            factory_auth.script_pubkey AS auth_script_pubkey,
            factory_auth.created_at_height AS auth_created_at_height,
            factory_program_utxo.txid AS program_txid,
            factory_program_utxo.vout AS program_vout,
            factory_program_utxo.created_at_height AS program_created_at_height
        FROM factory_auths AS factory_auth
        INNER JOIN factories AS factory
            ON factory.id = factory_auth.factory_id
        INNER JOIN factory_utxos AS factory_program_utxo
            ON factory_program_utxo.factory_id = factory.id
           AND factory_program_utxo.spent_txid IS NULL
        WHERE factory_auth.script_pubkey = $1
          AND factory_auth.spent_txid IS NULL
          AND factory.current_status = 'active'
        ORDER BY factory.id, factory_auth.created_at_height DESC
        "#,
        script_pubkey,
    )
    .fetch_all(db)
    .await?;

    let factories = rows.into_iter().map(FactoryDetailsResponse::from).collect();

    Ok(factories)
}

#[tracing::instrument(
    name = "Fetching factory by id from DB",
    skip(db, factory_id),
    fields(%factory_id)
)]
pub async fn fetch_by_id(
    db: &PgPool,
    factory_id: Uuid,
) -> Result<Option<FactoryDetailsResponse>, sqlx::Error> {
    let row = sqlx::query_as!(
        FactoryDetailsRow,
        r#"
        SELECT
            factory.id,
            factory.factory_asset_id,
            factory.program_script_pubkey,
            factory.current_status AS "current_status: FactoryStatus",
            factory.issuing_utxos_count,
            factory.reissuance_flags,
            factory.created_at_height,
            factory.created_at_txid,
            factory_auth.txid AS auth_txid,
            factory_auth.vout AS auth_vout,
            factory_auth.script_pubkey AS auth_script_pubkey,
            factory_auth.created_at_height AS auth_created_at_height,
            factory_program_utxo.txid AS program_txid,
            factory_program_utxo.vout AS program_vout,
            factory_program_utxo.created_at_height AS program_created_at_height
        FROM factories AS factory
        LEFT JOIN LATERAL (
            SELECT
                txid,
                vout,
                script_pubkey,
                created_at_height
            FROM factory_auths
            WHERE factory_id = factory.id
              AND spent_txid IS NULL
            ORDER BY created_at_height DESC
            LIMIT 1
        ) AS factory_auth ON true
        LEFT JOIN factory_utxos AS factory_program_utxo
            ON factory_program_utxo.factory_id = factory.id
           AND factory_program_utxo.spent_txid IS NULL
        WHERE factory.id = $1
        "#,
        factory_id,
    )
    .fetch_optional(db)
    .await?;

    Ok(row.map(FactoryDetailsResponse::from))
}
