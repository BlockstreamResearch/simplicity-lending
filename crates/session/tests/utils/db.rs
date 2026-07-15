use std::env;

use sqlx::PgPool;

const RUN_IT_ENV: &str = "RUN_SESSION_INDEXER_IT";

fn integration_tests_enabled() -> bool {
    matches!(env::var(RUN_IT_ENV).as_deref(), Ok("1"))
}

async fn test_pool() -> anyhow::Result<Option<PgPool>> {
    let Ok(database_url) = env::var("DATABASE_URL") else {
        return Ok(None);
    };

    let pool = PgPool::connect(&database_url).await?;
    sqlx::migrate!("../indexer/migrations").run(&pool).await?;
    sqlx::query(
        r#"
        TRUNCATE TABLE
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

    Ok(Some(pool))
}

pub async fn setup_test_pool() -> anyhow::Result<Option<PgPool>> {
    if !integration_tests_enabled() {
        eprintln!("Skipping test: set RUN_SESSION_INDEXER_IT=1 to run DB-backed integration tests");
        return Ok(None);
    }

    let Some(pool) = test_pool().await? else {
        eprintln!("Skipping test: DATABASE_URL is not set");
        return Ok(None);
    };

    Ok(Some(pool))
}
