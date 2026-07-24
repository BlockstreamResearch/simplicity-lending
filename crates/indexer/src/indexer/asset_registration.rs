//! ELIP-0100 asset metadata for the assets issued by the lending flow
//! (factory assets and offer NFTs).

use std::time::Duration;

use simplex::simplicityhl::elements::secp256k1_zkp::ZERO_TWEAK;
use simplex::simplicityhl::elements::{AssetId, ContractHash, OutPoint, Transaction};

use serde_json::json;

use crate::configuration::AssetRegistrySettings;

/// The BIP-341 NUMS point (compressed) as the contract `issuer_pubkey`.
const ISSUER_PUBKEY: &str = "0250929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0";

/// Protocol asset kinds issued with an ELIP-0100 contract.
///
/// Naming must stay in sync with `ASSET_KINDS` in `web/src/lwk/assetContract.ts`.
#[derive(Clone, Copy, Debug)]
pub enum AssetContractKind {
    Factory,
    BorrowerNft,
    LenderNft,
}

impl AssetContractKind {
    /// Role segment spliced into the contract `name` after the protocol tag.
    fn name_role(self) -> &'static str {
        match self {
            Self::Factory => "",
            Self::BorrowerNft => " borrower-nft",
            Self::LenderNft => " lender-nft",
        }
    }

    /// Ticker prefix; with 4 txid chars appended tickers stay at 7 chars
    /// (hardware wallets hold tickers in 8-byte buffers incl. NUL).
    fn ticker_prefix(self) -> &'static str {
        match self {
            Self::Factory => "SLF",
            Self::BorrowerNft => "SLB",
            Self::LenderNft => "SLL",
        }
    }
}

#[derive(Clone)]
pub struct AssetRegistration {
    domain: String,
    registry_url: Option<String>,
    client: reqwest::Client,
}

impl AssetRegistration {
    /// Returns `None` (feature disabled) when no issuer domain is configured.
    pub fn from_settings(settings: &AssetRegistrySettings) -> Option<Self> {
        let non_empty = |v: &Option<String>| v.clone().filter(|s| !s.trim().is_empty());

        let Some(domain) = non_empty(&settings.domain) else {
            tracing::warn!(
                "asset registration disabled: indexer.asset_registry.domain is not configured"
            );
            return None;
        };
        let registry_url = non_empty(&settings.registry_url);
        match &registry_url {
            Some(url) => {
                tracing::info!(domain, registry_url = url, "asset registration enabled");
            }
            None => tracing::warn!(
                domain,
                "asset contract checks enabled, but registry submission disabled: \
                 indexer.asset_registry.registry_url is not configured"
            ),
        }

        Some(Self {
            domain,
            registry_url,
            client: reqwest::ClientBuilder::new()
                .timeout(Duration::from_secs(15))
                .build()
                .expect("Failed to build reqwest client"),
        })
    }

    /// The contract the lending flow commits for a `kind` asset funded by `prevout`.
    ///
    /// Must stay in sync with `buildAssetContract` in `web/src/lwk/assetContract.ts`.
    fn expected_contract(&self, kind: AssetContractKind, prevout: &OutPoint) -> serde_json::Value {
        json!({
            "entity": { "domain": self.domain },
            "issuer_pubkey": ISSUER_PUBKEY,
            "name": format!(
                "simplicity-lending/v1{} {}:{}",
                kind.name_role(), prevout.txid, prevout.vout
            ),
            "precision": 0,
            "ticker": format!("{}{}", kind.ticker_prefix(), &prevout.txid.to_string()[..4]),
            "version": 0,
        })
    }

    /// Returns the expected contract when the creation transaction committed it.
    pub fn verified_contract(
        &self,
        kind: AssetContractKind,
        tx: &Transaction,
        asset_id: AssetId,
    ) -> Option<serde_json::Value> {
        let matched = tx
            .input
            .iter()
            .filter(|input| {
                input.has_issuance() && input.asset_issuance.asset_blinding_nonce == ZERO_TWEAK
            })
            .find_map(|input| {
                let prevout = input.previous_output;
                let contract = self.expected_contract(kind, &prevout);
                let contract_hash = ContractHash::from_json_contract(&contract.to_string()).ok()?;
                (AssetId::new_issuance(prevout, contract_hash) == asset_id)
                    .then_some((contract, contract_hash, prevout))
            });

        match matched {
            Some((contract, contract_hash, prevout)) => {
                tracing::info!(
                    ?kind, %asset_id, %prevout, %contract_hash,
                    "issuance commits the expected asset contract"
                );
                Some(contract)
            }
            None => {
                tracing::warn!(
                    ?kind, %asset_id,
                    "no issuance input commits the expected asset contract; not registering"
                );
                None
            }
        }
    }

    /// Fire-and-forget registry submission.
    ///
    /// The delayed retries cover the  block's DB commit (the domain proof is served from it)
    /// and transient registry errors.
    ///
    /// Failures are logged, never propagated (the registry is transport for the
    /// already-committed contract, not a trust anchor).
    pub fn spawn_registration(&self, asset_id: AssetId, contract: serde_json::Value) {
        let Some(registry_url) = &self.registry_url else {
            tracing::warn!(
                %asset_id,
                "registry submission skipped: indexer.asset_registry.registry_url is not configured"
            );
            return;
        };
        let url = format!("{}/", registry_url.trim_end_matches('/'));
        let asset_id = asset_id.to_string();
        let body = json!({ "asset_id": asset_id, "contract": contract }).to_string();
        let client = self.client.clone();

        tracing::info!(%asset_id, url, body, "scheduling asset registry submission");
        tokio::spawn(async move {
            // Exponential backoff over ~30 minutes: the registry fetches the
            // domain proof from this deployment, which may itself be
            // mid-restart when the factory gets indexed.
            for attempt in 1..=8u32 {
                let delay = (10u64 << (attempt - 1)).min(600);
                tracing::info!(%asset_id, attempt, delay, "asset registration attempt scheduled");
                tokio::time::sleep(Duration::from_secs(delay)).await;

                let response = client
                    .post(&url)
                    .header("content-type", "application/json")
                    .body(body.clone())
                    .send()
                    .await;

                match response {
                    Ok(response) if response.status().is_success() => {
                        tracing::info!(%asset_id, "asset contract registered");
                        return;
                    }
                    Ok(response) => {
                        let status = response.status().as_u16();
                        let detail = response.text().await.unwrap_or_default();
                        tracing::warn!(
                            %asset_id,
                            status,
                            detail,
                            "asset registration attempt {attempt} rejected"
                        );
                    }
                    Err(error) => {
                        tracing::warn!(
                            %asset_id,
                            %error,
                            "asset registration attempt {attempt} failed"
                        );
                    }
                }
            }
            tracing::warn!(%asset_id, "asset registration given up");
        });
    }
}

#[cfg(test)]
mod tests {
    use simplex::simplicityhl::elements::OutPoint;

    use super::{AssetContractKind, AssetRegistration};
    use crate::configuration::AssetRegistrySettings;

    const FUNDING_TXID: &str = "0e19e938c74378ae83b549213a12be88ede6e32e1407bfdf50c4ec3f927408ec";

    fn registration(domain: &str) -> AssetRegistration {
        AssetRegistration::from_settings(&AssetRegistrySettings {
            domain: Some(domain.to_string()),
            registry_url: None,
        })
        .expect("domain configured")
    }

    fn prevout() -> OutPoint {
        OutPoint::new(FUNDING_TXID.parse().expect("txid"), 0)
    }

    /// Pins the canonical serializations the web flow must reproduce
    /// (`buildAssetContract` in web/src/lwk/assetContract.ts).
    #[test]
    fn expected_contracts_are_deterministic() {
        let registration = registration("lending.example");

        for (kind, name_role, ticker) in [
            (AssetContractKind::Factory, "", "SLF0e19"),
            (AssetContractKind::BorrowerNft, " borrower-nft", "SLB0e19"),
            (AssetContractKind::LenderNft, " lender-nft", "SLL0e19"),
        ] {
            let contract = registration.expected_contract(kind, &prevout());
            assert_eq!(
                contract.to_string(),
                format!(
                    concat!(
                        "{{\"entity\":{{\"domain\":\"lending.example\"}},",
                        "\"issuer_pubkey\":\"0250929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0\",",
                        "\"name\":\"simplicity-lending/v1{} ",
                        "0e19e938c74378ae83b549213a12be88ede6e32e1407bfdf50c4ec3f927408ec:0\",",
                        "\"precision\":0,\"ticker\":\"{}\",\"version\":0}}"
                    ),
                    name_role, ticker
                ),
                "{kind:?}"
            );
        }
    }

    /// Pins the derivation against a live issuance: liquidtestnet tx
    /// 75bb4d3bb6a1485988a4bcf4ad33cbf66cd849a4b1dce5f0c3711539aafb13b8,
    /// created through lending.dev.blockstream.com.
    #[test]
    fn expected_contract_matches_live_issuance() {
        use simplex::simplicityhl::elements::{AssetId, ContractHash};

        let registration = registration("lending.dev.blockstream.com");
        let prevout = OutPoint::new(
            "b04bdd1e0d733026a60a3f12fc83f515b53f4195818be4104e1dd40d02ca8348"
                .parse()
                .expect("txid"),
            0,
        );

        let contract = registration.expected_contract(AssetContractKind::Factory, &prevout);
        let hash = ContractHash::from_json_contract(&contract.to_string()).expect("hash");
        assert_eq!(
            AssetId::new_issuance(prevout, hash).to_string(),
            "649d593b45d51b21a03ddf0773f67384b72ef337b0f689ed81e950a01f871f5f"
        );
    }
}
