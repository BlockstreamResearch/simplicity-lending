use std::{sync::Arc, time::Duration};

use sqlx::PgPool;
use tokio::time::interval;

use crate::{configuration::IndexerSettings, esplora_client::EsploraClient};

pub async fn run_indexer(settings: IndexerSettings, _db_pool: Arc<PgPool>, client: EsploraClient) {
    let mut interval = interval(Duration::from_millis(settings.interval));

    loop {
        interval.tick().await;

        match client.get_latest_block_height().await {
            Ok(height) => println!("Current height is {height}"),
            Err(error) => println!("Failed to get height: {error}"),
        }
    }
}
