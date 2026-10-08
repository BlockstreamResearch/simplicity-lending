use std::path::PathBuf;
use std::time::Duration;

use lending_indexer::client::IndexerClient;

use crate::config::Settings;

pub struct AppContext {
    pub settings: Settings,
    pub indexer: IndexerClient,
}

impl AppContext {
    pub fn harvest_interval(&self) -> Duration {
        Duration::from_secs(self.settings.schedule.interval_secs)
    }
}

pub fn state_path() -> PathBuf {
    resolve_state_path(
        std::env::var("HARVESTER_STATE_PATH").ok().as_deref(),
        process_dir().join("state.json"),
    )
}

fn resolve_state_path(override_path: Option<&str>, default_path: PathBuf) -> PathBuf {
    override_path
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .unwrap_or(default_path)
}

fn process_dir() -> PathBuf {
    std::env::current_dir().expect("Failed to determine the current directory")
}

#[cfg(test)]
mod tests {
    use super::resolve_state_path;

    #[test]
    fn state_path_prefers_the_environment_override() {
        let default_path = std::path::PathBuf::from("/app/state.json");

        assert_eq!(resolve_state_path(None, default_path.clone()), default_path);
        assert_eq!(
            resolve_state_path(Some("  "), default_path.clone()),
            default_path
        );
        assert_eq!(
            resolve_state_path(Some("/var/lib/harvester/state.json"), default_path),
            std::path::PathBuf::from("/var/lib/harvester/state.json")
        );
    }
}
