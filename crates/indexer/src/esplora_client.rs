use std::{num::ParseIntError, time::Duration};

use reqwest::{Client, ClientBuilder, Response};
use simplicityhl::elements::{Transaction, Txid, encode};

/// Default Esplora API base URL for Liquid testnet.
pub const DEFAULT_BASE_URL: &str = "https://blockstream.info/liquidtestnet/api";

/// Default request timeout in seconds.
pub const DEFAULT_TIMEOUT_SECS: u64 = 10;

/// Client for interacting with the Esplora API.
#[derive(Debug, Clone)]
pub struct EsploraClient {
    base_url: String,
    client: Client,
}

impl Default for EsploraClient {
    fn default() -> Self {
        Self::new()
    }
}

impl EsploraClient {
    #[must_use]
    pub fn new() -> Self {
        Self::with_base_url(DEFAULT_BASE_URL)
    }

    #[must_use]
    pub fn with_base_url(base_url: &str) -> Self {
        let timeout = Duration::from_secs(DEFAULT_TIMEOUT_SECS);
        let client = ClientBuilder::new()
            .timeout(timeout)
            .build()
            .expect("Failed to build reqwest client");

        Self {
            base_url: base_url.trim_end_matches('/').to_owned(),
            client,
        }
    }

    pub async fn get_latest_block_hash(&self) -> Result<String, EsploraClientError> {
        let url = format!("{}/blocks/tip/hash", self.base_url);

        let response = self.client.get(url).send().await?;
        let response = Self::handle_response(response).await?;

        response
            .text()
            .await
            .map_err(|error| EsploraClientError::Parsing(error.to_string()))
    }

    pub async fn get_latest_block_height(&self) -> Result<u64, EsploraClientError> {
        let url = format!("{}/blocks/tip/height", self.base_url);

        let response = self.client.get(url).send().await?;
        let response = Self::handle_response(response).await?;

        let body = response
            .text()
            .await
            .map_err(|error| EsploraClientError::Parsing(error.to_string()))?;

        body.parse()
            .map_err(|error: ParseIntError| EsploraClientError::IntParsing(error))
    }

    pub async fn get_block_hash_at_height(
        &self,
        block_height: u64,
    ) -> Result<String, EsploraClientError> {
        let url = format!("{}/block-height/{block_height}", self.base_url);

        let response = self.client.get(url).send().await?;
        let response = Self::handle_response(response).await?;

        response
            .text()
            .await
            .map_err(|error| EsploraClientError::Parsing(error.to_string()))
    }

    pub async fn get_block_txids(&self, block_hash: &str) -> Result<Vec<Txid>, EsploraClientError> {
        let url = format!("{}/block/{block_hash}/txids", self.base_url);

        let response = self.client.get(url).send().await?;
        let response = Self::handle_response(response).await?;

        let body = response
            .text()
            .await
            .map_err(|error| EsploraClientError::Parsing(error.to_string()))?;

        let raw_strings: Vec<String> = serde_json::from_str(&body)
            .map_err(|error| EsploraClientError::Parsing(error.to_string()))?;
        let txids: Vec<Txid> = raw_strings
            .into_iter()
            .filter_map(|s| s.parse::<Txid>().ok())
            .collect();

        Ok(txids)
    }

    pub async fn get_tx_by_id(&self, tx_id: Txid) -> Result<Transaction, EsploraClientError> {
        let url = format!("{}/tx/{tx_id}/raw", self.base_url);

        let response = self.client.get(url).send().await?;
        let response = Self::handle_response(response).await?;

        let bytes = response.bytes().await?;
        let tx: Transaction = encode::deserialize(&bytes)?;

        Ok(tx)
    }

    async fn handle_response(response: Response) -> Result<Response, EsploraClientError> {
        if response.status().is_success() {
            Ok(response)
        } else {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            Err(EsploraClientError::ApiStatus(status, body))
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum EsploraClientError {
    #[error("network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("int parsing error: {0}")]
    IntParsing(#[from] ParseIntError),
    #[error("invalid transaction hex: {0}")]
    InvalidTransactionHex(#[from] hex::FromHexError),
    #[error("failed to deserialize transaction: {0}")]
    TransactionDeserialize(#[from] simplicityhl::simplicity::elements::encode::Error),
    #[error("parsing error: {0}")]
    Parsing(String),
    #[error("api error: status {0}, body {1}")]
    ApiStatus(u16, String),
    #[error("not found")]
    NotFound,
}
