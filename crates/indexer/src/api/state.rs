use sqlx::PgPool;

use crate::api::events::EventBus;

pub struct AppState {
    pub db: PgPool,
    pub events: EventBus,
}
