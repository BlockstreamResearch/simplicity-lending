use std::path::PathBuf;
use std::time::Duration;

use lending_indexer::client::IndexerClient;

use crate::config::Settings;

pub mod cli;
pub mod commands;
pub mod config;
pub mod error;

pub struct AppContext {
    pub settings: Settings,
    pub indexer: IndexerClient,
}

impl AppContext {
    pub fn harvest_interval(&self) -> Duration {
        Duration::from_secs(self.settings.schedule.interval_secs)
    }
}

pub fn configuration_dir() -> PathBuf {
    std::env::current_dir()
        .expect("Failed to determine the current directory")
        .join("configuration")
}
