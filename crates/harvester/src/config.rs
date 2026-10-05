use std::path::PathBuf;

use serde::Deserialize;
use simplex::provider::SimplicityNetwork;
use simplex::simplicityhl::elements::OutPoint;

use crate::error::HarvesterError;

#[derive(Debug, Clone, Deserialize)]
pub struct Settings {
    pub indexer: IndexerSettings,
    pub esplora: EsploraSettings,
    pub schedule: ScheduleSettings,
    pub harvest: HarvestSettings,
    pub principal_asset: String,
    #[serde(default)]
    pub collector: CollectorSettings,
    #[serde(default)]
    pub withdraw: WithdrawSettings,
}

#[derive(Debug, Clone, Deserialize)]
pub struct IndexerSettings {
    pub base_url: String,
}

#[derive(Debug, Clone)]
pub struct EsploraSettings {
    pub base_url: String,
    network: SimplicityNetwork,
}

impl EsploraSettings {
    pub fn new(base_url: String, network: &str) -> Result<Self, HarvesterError> {
        Ok(Self {
            base_url,
            network: simplicity_network(network)?,
        })
    }

    pub fn simplicity_network(&self) -> SimplicityNetwork {
        self.network
    }
}

impl<'de> Deserialize<'de> for EsploraSettings {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        struct RawEsploraSettings {
            base_url: String,
            network: String,
        }

        let raw = RawEsploraSettings::deserialize(deserializer)?;
        Self::new(raw.base_url, &raw.network).map_err(serde::de::Error::custom)
    }
}

fn simplicity_network(network: &str) -> Result<SimplicityNetwork, HarvesterError> {
    match network.to_lowercase().as_str() {
        "liquid" => Ok(SimplicityNetwork::Liquid),
        "liquidtestnet" => Ok(SimplicityNetwork::LiquidTestnet),
        "regtest" | "elementsregtest" => Ok(SimplicityNetwork::default_regtest()),
        other => Err(HarvesterError::InvalidSetting {
            field: "esplora.network",
            value: other.to_owned(),
        }),
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct ScheduleSettings {
    pub interval_secs: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HarvestSettings {
    pub max_vaults_per_tx: u32,
    #[serde(default)]
    pub mnemonic: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct CollectorSettings {
    #[serde(default)]
    pub withdraw_pubkey: String,
    #[serde(default)]
    pub outpoint: Option<OutPoint>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct WithdrawSettings {
    #[serde(default)]
    pub mnemonic: String,
    #[serde(default)]
    pub destination_address: String,
}

pub fn get_configuration() -> Result<Settings, config::ConfigError> {
    load_configuration(&configuration_dir(), environment_source())
}

fn configuration_dir() -> PathBuf {
    resolve_configuration_dir(
        std::env::var("HARVESTER_CONFIGURATION_DIR").ok().as_deref(),
        std::env::current_dir()
            .expect("Failed to determine the current directory")
            .join("configuration"),
    )
}

fn resolve_configuration_dir(override_path: Option<&str>, default_dir: PathBuf) -> PathBuf {
    override_path
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .unwrap_or(default_dir)
}

fn load_configuration(
    directory: &std::path::Path,
    environment: config::Environment,
) -> Result<Settings, config::ConfigError> {
    config::Config::builder()
        .add_source(config::File::from(directory.join("base.yaml")))
        .add_source(environment)
        .build()?
        .try_deserialize()
}

fn environment_source() -> config::Environment {
    config::Environment::with_prefix("HARVESTER")
        .prefix_separator("_")
        .separator("__")
        .try_parsing(true)
        .ignore_empty(true)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use simplex::provider::SimplicityNetwork;

    use super::{
        EsploraSettings, environment_source, load_configuration, resolve_configuration_dir,
    };
    use crate::error::HarvesterError;

    fn configuration_dir() -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("configuration")
    }

    fn load_base() -> super::Settings {
        load_configuration(
            &configuration_dir(),
            environment_source().source(Some(HashMap::new())),
        )
        .expect("load base.yaml")
    }

    #[test]
    fn base_yaml_deserializes() {
        let settings = load_base();

        assert_eq!(settings.indexer.base_url, "http://127.0.0.1:8000");
        assert_eq!(
            settings.esplora.base_url,
            "https://liquid.network/liquidtestnet/api"
        );
        assert_eq!(settings.schedule.interval_secs, 86400);
        assert_eq!(settings.harvest.max_vaults_per_tx, 25);
        assert_eq!(
            settings.principal_asset,
            "38fca2d939696061a8f76d4e6b5eecd54e3b4221c846f24a6b279e79952850a5"
        );
        assert!(settings.harvest.mnemonic.is_empty());
        assert!(settings.withdraw.mnemonic.is_empty());
        assert!(settings.collector.withdraw_pubkey.is_empty());
        assert!(settings.collector.outpoint.is_none());
        assert!(settings.withdraw.destination_address.is_empty());
        assert_eq!(
            settings.esplora.simplicity_network(),
            SimplicityNetwork::LiquidTestnet
        );
    }

    #[test]
    fn harvester_environment_overrides_base_yaml() {
        let settings = load_configuration(
            &configuration_dir(),
            environment_source().source(Some(HashMap::from([
                ("HARVESTER_SCHEDULE__INTERVAL_SECS".into(), "30".into()),
                ("HARVESTER_HARVEST__MNEMONIC".into(), "secret".into()),
                ("SCHEDULE__INTERVAL_SECS".into(), "1".into()),
            ]))),
        )
        .expect("load configuration");

        assert_eq!(settings.schedule.interval_secs, 30);
        assert_eq!(settings.harvest.mnemonic, "secret");
        assert_eq!(settings.harvest.max_vaults_per_tx, 25);
    }

    #[test]
    fn collector_outpoint_parses_txid_and_vout() {
        let txid = "11".repeat(32);
        let settings = load_configuration(
            &configuration_dir(),
            environment_source().source(Some(HashMap::from([(
                "HARVESTER_COLLECTOR__OUTPOINT".into(),
                format!("{txid}:2"),
            )]))),
        )
        .expect("load configuration");

        let outpoint = settings.collector.outpoint.expect("outpoint");
        assert_eq!(outpoint.txid.to_string(), txid);
        assert_eq!(outpoint.vout, 2);
    }

    #[test]
    fn collector_outpoint_rejects_an_invalid_txid() {
        let error = load_configuration(
            &configuration_dir(),
            environment_source().source(Some(HashMap::from([(
                "HARVESTER_COLLECTOR__OUTPOINT".into(),
                "zz:0".into(),
            )]))),
        )
        .expect_err("invalid outpoint");

        let message = error.to_string();
        assert!(message.contains("collector.outpoint"), "{message}");
    }

    #[test]
    fn configuration_dir_prefers_the_environment_override() {
        let default_dir = std::path::PathBuf::from("/app/configuration");

        assert_eq!(
            resolve_configuration_dir(None, default_dir.clone()),
            default_dir
        );
        assert_eq!(
            resolve_configuration_dir(Some("  "), default_dir.clone()),
            default_dir
        );
        assert_eq!(
            resolve_configuration_dir(Some("/etc/harvester"), default_dir),
            std::path::PathBuf::from("/etc/harvester")
        );
    }

    #[test]
    fn esplora_settings_reject_an_unknown_network() {
        let error = EsploraSettings::new("http://localhost".to_owned(), "mainnet").unwrap_err();

        assert!(matches!(
            error,
            HarvesterError::InvalidSetting {
                field: "esplora.network",
                ..
            }
        ));
    }
}
