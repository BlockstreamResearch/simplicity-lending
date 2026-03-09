use sqlx::{PgPool, Postgres, Transaction, migrate::Migrator};

pub type DbTx<'a> = Transaction<'a, Postgres>;

static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

pub async fn run_migrations(pool: &PgPool) -> Result<(), sqlx::migrate::MigrateError> {
    MIGRATOR.run(pool).await
}
