use sqlx::types::chrono::{DateTime, Utc};

#[derive(Debug, sqlx::FromRow)]
pub struct SyncModel {
    pub id: i32,
    pub last_indexed_height: i64,
    pub last_indexed_hash: String,
    pub updated_at: DateTime<Utc>,
}
