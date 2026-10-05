use std::fs::{File, OpenOptions};
use std::io::{ErrorKind, Write};
use std::os::unix::io::AsRawFd;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::HarvesterError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct State {
    pub outpoint: Outpoint,
    #[serde(default)]
    pub pending_txid: Option<String>,
    #[serde(default)]
    pub pending_script: Option<String>,
    #[serde(default)]
    pub pending_tx: Option<String>,
    #[serde(default)]
    pub closed: bool,
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
    use crate::error::HarvesterError;
    use crate::test_utils::TempDir;

    use super::{Outpoint, State, StateLock};

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
            pending_script: Some("51".to_owned()),
            pending_tx: Some("00".to_owned()),
            closed: false,
        };

        state.save(&path).unwrap();
        assert_eq!(State::load(&path).unwrap().as_ref(), Some(&state));

        let cleared = State {
            pending_txid: None,
            ..state
        };
        cleared.save(&path).unwrap();

        assert_eq!(State::load(&path).unwrap().as_ref(), Some(&cleared));
        assert!(!dir.path.join("state.json.tmp").exists());

        let closed = State {
            closed: true,
            pending_txid: None,
            pending_script: None,
            pending_tx: None,
            ..cleared
        };
        closed.save(&path).unwrap();
        assert_eq!(State::load(&path).unwrap().as_ref(), Some(&closed));
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
    fn pending_script_defaults_when_absent() {
        let parsed: State =
            serde_json::from_str(r#"{"outpoint":{"txid":"aa","vout":0},"pending_txid":"bb"}"#)
                .unwrap();

        assert_eq!(parsed.pending_script, None);
        assert_eq!(parsed.pending_tx, None);
        assert_eq!(parsed.pending_txid.as_deref(), Some("bb"));
        assert!(!parsed.closed);
    }
}
