use anyhow::Context;
use sqlx::PgPool;

pub async fn setup_test_pool() -> anyhow::Result<PgPool> {
    let _ = dotenvy::dotenv();

    let database_url = std::env::var("DATABASE_URL")
        .context("DATABASE_URL must be set in the environment or .env for integration tests")?;

    let pool = PgPool::connect(&database_url).await?;
    sqlx::migrate!("../indexer/migrations").run(&pool).await?;
    sqlx::query(
        r#"
        TRUNCATE TABLE
            offer_vaults,
            offer_participants,
            offer_utxos,
            offers,
            factory_auths,
            factory_utxos,
            factories,
            sync_state
        RESTART IDENTITY CASCADE
        "#,
    )
    .execute(&pool)
    .await?;

    Ok(pool)
}
