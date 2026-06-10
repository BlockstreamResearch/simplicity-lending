use uuid::Uuid;

use crate::{db::DbTx, models::FactoryModel};

#[tracing::instrument(
    name = "Inserting factory into DB",
    skip(sql_tx, factory),
    fields(factory_id = %factory.id)
)]
pub async fn insert_factory(
    sql_tx: &mut DbTx<'_>,
    factory: &FactoryModel,
) -> Result<Option<Uuid>, sqlx::Error> {
    let row = sqlx::query!(
        r#"
        INSERT INTO factories (
            id, factory_asset_id, program_script_pubkey, issuing_utxos_count,
            reissuance_flags, created_at_height, created_at_txid
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (created_at_txid) DO NOTHING
        RETURNING id
        "#,
        factory.id,
        factory.factory_asset_id,
        factory.program_script_pubkey,
        factory.issuing_utxos_count,
        factory.reissuance_flags,
        factory.created_at_height,
        factory.created_at_txid,
    )
    .fetch_optional(&mut **sql_tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to insert factory to the DB: {e:?}");
        e
    })?;

    Ok(row.map(|r| r.id))
}
