use std::{future::Future, sync::Arc, time::Duration};

use simplex::{
    provider::{EsploraProvider, ProviderTrait, SimplicityNetwork},
    simplicityhl::elements::Transaction,
};

use crate::{configuration::EsploraSettings, indexer::provider::call_provider};

/// A block fetched from the chain, ready to be indexed.
#[derive(Debug, Clone)]
pub struct ChainBlock {
    pub height: u64,
    pub hash: String,
    pub txs: Vec<Transaction>,
}

/// Read access to the chain the indexer follows.
pub trait ChainSource {
    fn tip_height(&self) -> impl Future<Output = anyhow::Result<u64>> + Send;

    fn block_hash_at(&self, height: u64) -> impl Future<Output = anyhow::Result<String>> + Send;

    /// Hash of the block that block `hash` builds on.
    fn block_parent_hash(&self, hash: &str) -> impl Future<Output = anyhow::Result<String>> + Send;

    fn block_txs(
        &self,
        hash: &str,
    ) -> impl Future<Output = anyhow::Result<Vec<Transaction>>> + Send;
}

/// [`ChainSource`] backed by an Esplora API.
pub struct EsploraChainSource {
    provider: Arc<EsploraProvider>,
    client: reqwest::Client,
    base_url: String,
}

impl EsploraChainSource {
    pub fn new(settings: &EsploraSettings) -> Self {
        Self {
            provider: Arc::new(settings.provider()),
            client: reqwest::ClientBuilder::new()
                .timeout(Duration::from_secs(settings.timeout.into()))
                .build()
                .expect("Failed to build reqwest client"),
            base_url: settings.base_url.trim_end_matches('/').to_owned(),
        }
    }

    pub fn network(&self) -> SimplicityNetwork {
        *self.provider.get_network()
    }
}

/// The part of Esplora's `GET /block/:hash` response the indexer reads.
#[derive(serde::Deserialize)]
struct EsploraBlock {
    previousblockhash: Option<String>,
}

impl ChainSource for EsploraChainSource {
    async fn tip_height(&self) -> anyhow::Result<u64> {
        let height = call_provider(&self.provider, |provider| provider.fetch_tip_height()).await?;

        Ok(height.into())
    }

    async fn block_hash_at(&self, height: u64) -> anyhow::Result<String> {
        let height = u32::try_from(height)?;

        call_provider(&self.provider, move |provider| {
            provider.fetch_block_hash_at_height(height)
        })
        .await
    }

    // The Simplex provider does not expose the block header, so it is read directly.
    async fn block_parent_hash(&self, hash: &str) -> anyhow::Result<String> {
        let body = self
            .client
            .get(format!("{}/block/{hash}", self.base_url))
            .send()
            .await?
            .error_for_status()?
            .text()
            .await?;
        let block: EsploraBlock = serde_json::from_str(&body)?;

        block
            .previousblockhash
            .ok_or_else(|| anyhow::anyhow!("block {hash} has no parent"))
    }

    async fn block_txs(&self, hash: &str) -> anyhow::Result<Vec<Transaction>> {
        let hash = hash.to_owned();

        call_provider(&self.provider, move |provider| {
            provider
                .fetch_block_txids(&hash)?
                .iter()
                .map(|txid| provider.fetch_transaction(txid))
                .collect()
        })
        .await
    }
}
