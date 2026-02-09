use sqlx::PgPool;

pub async fn get_starting_height(db: &PgPool, config_height: u64) -> u64 {
    let row = sqlx::query!("SELECT last_indexed_height FROM sync_state WHERE id = 1")
        .fetch_optional(db)
        .await
        .unwrap_or(None);

    match row {
        Some(r) => r.last_indexed_height as u64,
        None => {
            tracing::info!(
                "No sync state found in DB, starting from config: {}",
                config_height
            );
            config_height
        }
    }
}
