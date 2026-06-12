use sqlx::PgPool;

pub struct AppState {
    pub db: PgPool,
}
