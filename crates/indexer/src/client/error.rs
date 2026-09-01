use serde::Deserialize;

#[derive(Debug, thiserror::Error)]
pub enum IndexerClientError {
    #[error("invalid client configuration: {0}")]
    InvalidConfig(String),

    #[error("request timed out")]
    Timeout,

    #[error("transport error: {0}")]
    Transport(String),

    #[error("resource not found: {0}")]
    NotFound(String),

    #[error("indexer API error (status {status}, code {code}): {message}")]
    Api {
        status: u16,
        code: String,
        message: String,
    },

    #[error("failed to decode response: {0}")]
    Decode(String),
}

impl From<reqwest::Error> for IndexerClientError {
    fn from(error: reqwest::Error) -> Self {
        if error.is_timeout() {
            Self::Timeout
        } else if error.is_builder() {
            Self::InvalidConfig(error.to_string())
        } else {
            Self::Transport(error.to_string())
        }
    }
}

#[derive(Debug, Deserialize)]
struct ApiErrorBody {
    error: ApiErrorDetail,
}

#[derive(Debug, Deserialize)]
struct ApiErrorDetail {
    code: String,
    message: String,
}

/// Parses indexer error envelope and falls back to raw body text.
pub(crate) fn map_api_error(status: u16, body: &[u8]) -> IndexerClientError {
    let (code, message) = match serde_json::from_slice::<ApiErrorBody>(body) {
        Ok(parsed) => (parsed.error.code, parsed.error.message),
        Err(_) => (
            "unknown".to_string(),
            String::from_utf8_lossy(body).into_owned(),
        ),
    };

    if status == 404 {
        IndexerClientError::NotFound(message)
    } else {
        IndexerClientError::Api {
            status,
            code,
            message,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn map_api_error_parses_indexer_envelope() {
        let body = br#"{"error":{"code":"bad_request","message":"invalid params"}}"#;
        match map_api_error(400, body) {
            IndexerClientError::Api {
                status,
                code,
                message,
            } => {
                assert_eq!(status, 400);
                assert_eq!(code, "bad_request");
                assert_eq!(message, "invalid params");
            }
            other => panic!("expected Api error, got {other:?}"),
        }
    }

    #[test]
    fn map_api_error_maps_404_to_not_found() {
        let body = br#"{"error":{"code":"not_found","message":"Resource not found: offer-1"}}"#;
        match map_api_error(404, body) {
            IndexerClientError::NotFound(message) => {
                assert_eq!(message, "Resource not found: offer-1");
            }
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    #[test]
    fn map_api_error_falls_back_to_raw_body() {
        let body = b"upstream exploded";
        match map_api_error(502, body) {
            IndexerClientError::Api {
                status,
                code,
                message,
            } => {
                assert_eq!(status, 502);
                assert_eq!(code, "unknown");
                assert_eq!(message, "upstream exploded");
            }
            other => panic!("expected Api error, got {other:?}"),
        }
    }
}
