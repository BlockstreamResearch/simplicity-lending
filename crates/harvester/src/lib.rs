use std::path::PathBuf;
use std::time::Duration;

use lending_indexer::client::IndexerClient;

use crate::config::Settings;

mod batch;
pub mod cli;
pub mod commands;
pub mod config;
pub mod error;
pub mod state;
mod vaults;

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
    process_dir().join("configuration")
}

pub fn state_path() -> PathBuf {
    process_dir().join("state.json")
}

fn process_dir() -> PathBuf {
    std::env::current_dir().expect("Failed to determine the current directory")
}
