use uuid::Uuid;

use crate::{db::DbTx, models::FactoryIdentity};

#[tracing::instrument(
    name = "Getting factory identity from DB",
    skip(sql_tx),
    fields(%factory_id)
)]
pub async fn get_factory_identity(
    sql_tx: &mut DbTx<'_>,
    factory_id: Uuid,
) -> Result<FactoryIdentity, sqlx::Error> {
    let factory_row = sqlx::query_as!(
        FactoryIdentity,
        r#"
        SELECT factory_asset_id, program_script_pubkey
        FROM factories
        WHERE id = $1
        "#,
        factory_id
    )
    .fetch_one(&mut **sql_tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to get factory identity: {e:?}");
        e
    })?;

    Ok(FactoryIdentity {
        factory_asset_id: factory_row.factory_asset_id,
        program_script_pubkey: factory_row.program_script_pubkey,
    })
}
