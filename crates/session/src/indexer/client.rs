use std::time::Duration;

use reqwest::Client;
use serde::de::DeserializeOwned;
use uuid::Uuid;

use super::error::{IndexerClientError, map_api_error};
use super::query::OfferListParams;
use super::types::{
    BorrowerOverview, FactoryDetailsResponse, LenderOverview, OfferDetailsResponse,
    OfferListResponse, OffersOverview,
};

pub const DEFAULT_TIMEOUT_SECS: u64 = 30;

#[derive(Debug, Clone)]
pub struct IndexerClientConfig {
    pub base_url: String,
    pub timeout: Duration,
}

impl IndexerClientConfig {
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
            timeout: Duration::from_secs(DEFAULT_TIMEOUT_SECS),
        }
    }

    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }
}

#[derive(Debug, Clone)]
pub struct IndexerClient {
    base_url: String,
    http: Client,
}

impl IndexerClient {
    pub fn new(base_url: impl Into<String>) -> Result<Self, IndexerClientError> {
        Self::with_config(IndexerClientConfig::new(base_url))
    }

    pub fn with_config(config: IndexerClientConfig) -> Result<Self, IndexerClientError> {
        let http = Client::builder().timeout(config.timeout).build()?;

        Ok(Self {
            base_url: config.base_url.trim_end_matches('/').to_owned(),
            http,
        })
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub async fn list_offers(
        &self,
        params: &OfferListParams,
    ) -> Result<OfferListResponse, IndexerClientError> {
        self.get("/offers", &params.to_query_pairs()).await
    }

    pub async fn get_offer(
        &self,
        offer_id: Uuid,
    ) -> Result<OfferDetailsResponse, IndexerClientError> {
        self.get(&format!("/offers/{offer_id}"), &[]).await
    }

    pub async fn get_offer_ids_by_script(
        &self,
        script_pubkey: &str,
    ) -> Result<Vec<Uuid>, IndexerClientError> {
        self.get(
            "/offers/by-script",
            &[("script_pubkey", script_pubkey.to_string())],
        )
        .await
    }

    pub async fn get_offers_overview(&self) -> Result<OffersOverview, IndexerClientError> {
        self.get("/offers/overview", &[]).await
    }

    pub async fn list_borrower_offers(
        &self,
        script_pubkey: &str,
        params: &OfferListParams,
    ) -> Result<OfferListResponse, IndexerClientError> {
        let mut query = params.to_query_pairs();
        query.push(("script_pubkey", script_pubkey.to_string()));
        self.get("/borrowers/offers", &query).await
    }

    pub async fn get_borrower_overview(
        &self,
        script_pubkey: &str,
    ) -> Result<BorrowerOverview, IndexerClientError> {
        self.get(
            "/borrowers/overview",
            &[("script_pubkey", script_pubkey.to_string())],
        )
        .await
    }

    pub async fn list_lender_offers(
        &self,
        script_pubkey: &str,
        params: &OfferListParams,
    ) -> Result<OfferListResponse, IndexerClientError> {
        let mut query = params.to_query_pairs();
        query.push(("script_pubkey", script_pubkey.to_string()));
        self.get("/lenders/offers", &query).await
    }

    pub async fn get_lender_overview(
        &self,
        script_pubkey: &str,
    ) -> Result<LenderOverview, IndexerClientError> {
        self.get(
            "/lenders/overview",
            &[("script_pubkey", script_pubkey.to_string())],
        )
        .await
    }

    pub async fn get_factories_by_script(
        &self,
        script_pubkey: &str,
    ) -> Result<Vec<FactoryDetailsResponse>, IndexerClientError> {
        self.get(
            "/factories/by-script",
            &[("script_pubkey", script_pubkey.to_string())],
        )
        .await
    }

    pub async fn get_factory(
        &self,
        factory_id: Uuid,
    ) -> Result<FactoryDetailsResponse, IndexerClientError> {
        self.get(&format!("/factories/{factory_id}"), &[]).await
    }

    async fn get<T: DeserializeOwned>(
        &self,
        path: &str,
        query: &[(&str, String)],
    ) -> Result<T, IndexerClientError> {
        let url = format!("{}{}", self.base_url, path);

        let response = self.http.get(url).query(query).send().await?;
        let status = response.status();
        let body = response.bytes().await?;

        if !status.is_success() {
            return Err(map_api_error(status.as_u16(), &body));
        }

        decode(&body)
    }
}

fn decode<T: DeserializeOwned>(body: &[u8]) -> Result<T, IndexerClientError> {
    let value: serde_json::Value =
        serde_json::from_slice(body).map_err(|e| IndexerClientError::Decode(e.to_string()))?;

    serde_json::from_value(value).map_err(|e| IndexerClientError::Decode(e.to_string()))
}
