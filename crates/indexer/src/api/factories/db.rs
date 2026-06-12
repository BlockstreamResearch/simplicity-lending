use simplex::simplicityhl::elements::hex::ToHex;
use sqlx::PgPool;

use super::dto::{FactoryByScriptResponse, FactoryByScriptRow};

#[tracing::instrument(
    name = "Fetching factories by script from DB",
    skip(db, script_pubkey),
    fields(script_pubkey = %script_pubkey.to_hex())
)]
pub async fn fetch_factories_by_script(
    db: &PgPool,
    script_pubkey: &[u8],
) -> Result<Vec<FactoryByScriptResponse>, sqlx::Error> {
    let rows = sqlx::query_as::<_, FactoryByScriptRow>(
        r#"
        SELECT DISTINCT ON (factory.id)
            factory.id,
            factory.factory_asset_id,
            factory.program_script_pubkey,
            factory.current_status,
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
    )
    .bind(script_pubkey)
    .fetch_all(db)
    .await?;

    let factories = rows
        .into_iter()
        .map(FactoryByScriptResponse::from)
        .collect();

    Ok(factories)
}
