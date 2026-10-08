use std::fs::{File, OpenOptions};
use std::io::{ErrorKind, Write};
use std::os::unix::io::AsRawFd;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use simplex::simplicityhl::elements::{OutPoint, Txid};

use crate::error::HarvesterError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct State {
    pub outpoint: Option<OutPoint>,
    pub pending_txid: Option<Txid>,
    pub pending_collector_output: bool,
}

#[must_use = "the collector state stays locked until this value is dropped"]
pub struct StateLock {
    _file: File,
}

impl StateLock {
    pub fn lock(path: &Path) -> Result<Self, HarvesterError> {
        let lock_path = lock_path(path);
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(&lock_path)
            .map_err(|source| io_error(&lock_path, source))?;
        lock_exclusive(&file).map_err(|source| io_error(&lock_path, source))?;
        Ok(Self { _file: file })
    }
}

impl State {
    pub fn load(path: &Path) -> Result<Option<Self>, HarvesterError> {
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

    pub fn save(&self, path: &Path) -> Result<(), HarvesterError> {
        let tmp_path = temporary_path(path);
        if let Err(err) = self.write_temporary(path, &tmp_path) {
            let _ = std::fs::remove_file(&tmp_path);
            return Err(err);
        }
        if let Err(source) = std::fs::rename(&tmp_path, path) {
            let _ = std::fs::remove_file(&tmp_path);
            return Err(io_error(path, source));
        }
        Ok(())
    }

    pub fn remove(path: &Path) -> Result<(), HarvesterError> {
        match std::fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(source) if source.kind() == ErrorKind::NotFound => Ok(()),
            Err(source) => Err(io_error(path, source)),
        }
    }

    fn write_temporary(&self, path: &Path, tmp_path: &Path) -> Result<(), HarvesterError> {
        let mut payload =
            serde_json::to_vec_pretty(self).map_err(|source| HarvesterError::InvalidState {
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
}

fn lock_exclusive(file: &File) -> std::io::Result<()> {
    let rc = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) };
    if rc == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

fn lock_path(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .unwrap_or(std::ffi::OsStr::new("state.json"));
    let mut lock_name = name.to_os_string();
    lock_name.push(".lock");
    path.with_file_name(lock_name)
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
    use std::str::FromStr;

    use simplex::simplicityhl::elements::{OutPoint, Txid};

    use crate::error::HarvesterError;
    use crate::test_utils::TempDir;

    use super::{State, StateLock};

    #[test]
    fn roundtrip_replaces_the_previous_file() {
        let dir = TempDir::new();
        let path = dir.path.join("state.json");
        let state = State {
            outpoint: Some(OutPoint {
                txid: Txid::from_str(&"aa".repeat(32)).unwrap(),
                vout: 1,
            }),
            pending_txid: Some(Txid::from_str(&"bb".repeat(32)).unwrap()),
            pending_collector_output: true,
        };

        state.save(&path).unwrap();
        assert_eq!(State::load(&path).unwrap().as_ref(), Some(&state));

        let cleared = State {
            pending_txid: None,
            pending_collector_output: false,
            ..state
        };
        cleared.save(&path).unwrap();

        assert_eq!(State::load(&path).unwrap().as_ref(), Some(&cleared));
        assert!(!dir.path.join("state.json.tmp").exists());

        let empty = State {
            outpoint: None,
            pending_txid: None,
            pending_collector_output: false,
        };
        empty.save(&path).unwrap();
        assert_eq!(State::load(&path).unwrap().as_ref(), Some(&empty));
    }

    #[test]
    fn lock_can_be_taken_again_after_it_is_dropped() {
        let dir = TempDir::new();
        let path = dir.path.join("state.json");

        let held = StateLock::lock(&path).unwrap();
        assert!(dir.path.join("state.json.lock").exists());
        drop(held);

        let _again = StateLock::lock(&path).unwrap();
    }

    #[test]
    fn missing_file_is_absent_state() {
        let dir = TempDir::new();

        assert_eq!(State::load(&dir.path.join("state.json")).unwrap(), None);
    }

    #[test]
    fn invalid_json_is_an_error() {
        let dir = TempDir::new();
        let path = dir.path.join("state.json");
        std::fs::write(&path, b"{").unwrap();

        assert!(matches!(
            State::load(&path).unwrap_err(),
            HarvesterError::InvalidState { .. }
        ));
    }

    #[test]
    fn remove_tolerates_a_missing_state_file() {
        let dir = TempDir::new();
        let path = dir.path.join("state.json");

        State::remove(&path).unwrap();
        assert!(!path.exists());
    }
}
