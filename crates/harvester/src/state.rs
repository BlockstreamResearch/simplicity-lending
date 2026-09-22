use std::fs::File;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::HarvesterError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct State {
    pub outpoint: Outpoint,
    #[serde(default)]
    pub pending_txid: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Outpoint {
    pub txid: String,
    pub vout: u32,
}

impl std::fmt::Display for Outpoint {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}:{}", self.txid, self.vout)
    }
}

pub fn load(path: &Path) -> Result<Option<State>, HarvesterError> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(source) if source.kind() == ErrorKind::NotFound => return Ok(None),
        Err(source) => return Err(io_error(path, source)),
    };

    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|source| HarvesterError::InvalidState {
            path: path.to_path_buf(),
            source,
        })
}

pub fn remove(path: &Path) -> Result<(), HarvesterError> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(source) if source.kind() == ErrorKind::NotFound => Ok(()),
        Err(source) => Err(io_error(path, source)),
    }
}

pub fn save(path: &Path, state: &State) -> Result<(), HarvesterError> {
    let tmp_path = temporary_path(path);
    if let Err(err) = write_temporary(path, &tmp_path, state) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(err);
    }
    if let Err(source) = std::fs::rename(&tmp_path, path) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(io_error(path, source));
    }
    Ok(())
}

fn write_temporary(path: &Path, tmp_path: &Path, state: &State) -> Result<(), HarvesterError> {
    let mut payload =
        serde_json::to_vec_pretty(state).map_err(|source| HarvesterError::InvalidState {
            path: path.to_path_buf(),
            source,
        })?;
    payload.push(b'\n');

    let mut file = File::create(tmp_path).map_err(|source| io_error(tmp_path, source))?;
    file.write_all(&payload)
        .map_err(|source| io_error(tmp_path, source))?;
    file.sync_all()
        .map_err(|source| io_error(tmp_path, source))?;
    Ok(())
}

fn temporary_path(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .unwrap_or(std::ffi::OsStr::new("state.json"));
    let mut tmp_name = name.to_os_string();
    tmp_name.push(".tmp");
    path.with_file_name(tmp_name)
}

fn io_error(path: &Path, source: std::io::Error) -> HarvesterError {
    HarvesterError::StateIo {
        path: path.to_path_buf(),
        source,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU64, Ordering};

    use crate::error::HarvesterError;

    use super::{Outpoint, State, load, remove, save};

    #[test]
    fn roundtrip_replaces_the_previous_file() {
        let dir = TempDir::new();
        let path = dir.path.join("state.json");
        let state = State {
            outpoint: Outpoint {
                txid: "aa".to_owned(),
                vout: 1,
            },
            pending_txid: Some("bb".to_owned()),
        };

        save(&path, &state).unwrap();
        assert_eq!(load(&path).unwrap().as_ref(), Some(&state));

        let cleared = State {
            pending_txid: None,
            ..state
        };
        save(&path, &cleared).unwrap();

        assert_eq!(load(&path).unwrap().as_ref(), Some(&cleared));
        assert!(!dir.path.join("state.json.tmp").exists());
    }

    #[test]
    fn remove_deletes_the_file() {
        let dir = TempDir::new();
        let path = dir.path.join("state.json");
        save(
            &path,
            &State {
                outpoint: Outpoint {
                    txid: "aa".to_owned(),
                    vout: 0,
                },
                pending_txid: None,
            },
        )
        .unwrap();

        remove(&path).unwrap();
        assert_eq!(load(&path).unwrap(), None);
        remove(&path).unwrap();
    }

    #[test]
    fn missing_file_is_absent_state() {
        let dir = TempDir::new();

        assert_eq!(load(&dir.path.join("state.json")).unwrap(), None);
    }

    #[test]
    fn invalid_json_is_an_error() {
        let dir = TempDir::new();
        let path = dir.path.join("state.json");
        std::fs::write(&path, b"{").unwrap();

        assert!(matches!(
            load(&path).unwrap_err(),
            HarvesterError::InvalidState { .. }
        ));
    }

    struct TempDir {
        path: std::path::PathBuf,
    }

    impl TempDir {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let n = NEXT.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "lending-harvester-state-{}-{n}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }
}
