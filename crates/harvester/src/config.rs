use serde::Deserialize;
use simplex::provider::SimplicityNetwork;

use crate::configuration_dir;
use crate::error::HarvesterError;

#[derive(Debug, Clone, Deserialize)]
pub struct Settings {
    pub indexer: IndexerSettings,
    pub esplora: EsploraSettings,
    pub schedule: ScheduleSettings,
    pub harvest: HarvestSettings,
    pub principal_asset: String,
    pub keeper_asset: String,
    pub collector: CollectorSettings,
    pub withdraw: WithdrawSettings,
}

#[derive(Debug, Clone, Deserialize)]
pub struct IndexerSettings {
    pub base_url: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EsploraSettings {
    pub base_url: String,
    pub network: String,
}

impl EsploraSettings {
    pub fn simplicity_network(&self) -> Result<SimplicityNetwork, HarvesterError> {
        match self.network.to_lowercase().as_str() {
            "liquid" => Ok(SimplicityNetwork::Liquid),
            "liquidtestnet" => Ok(SimplicityNetwork::LiquidTestnet),
            "regtest" | "elementsregtest" => Ok(SimplicityNetwork::default_regtest()),
            other => Err(HarvesterError::InvalidSetting {
                field: "esplora.network",
                value: other.to_owned(),
            }),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct ScheduleSettings {
    pub interval_secs: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HarvestSettings {
    pub min_vault_amount: u64,
    pub min_batch_total: u64,
    pub max_vaults_per_tx: u32,
    pub fee_rate: u64,
    pub mnemonic: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CollectorSettings {
    pub withdraw_pubkey: String,
    #[serde(default)]
    pub outpoint: Option<OutpointSettings>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OutpointSettings {
    pub txid: String,
    pub vout: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WithdrawSettings {
    pub mnemonic: String,
    #[serde(default)]
    pub destination_address: String,
}

pub fn get_configuration() -> Result<Settings, config::ConfigError> {
    let configuration_directory = configuration_dir();

    let environment: Environment = std::env::var("APP_ENVIRONMENT")
        .unwrap_or_else(|_| "local".into())
        .try_into()
        .expect("Failed to parse APP_ENVIRONMENT.");
    let environment_filename = format!("{}.yaml", environment.as_str());

    let settings = config::Config::builder()
        .add_source(config::File::from(
            configuration_directory.join("base.yaml"),
        ))
        .add_source(config::File::from(
            configuration_directory.join(environment_filename),
        ))
        .add_source(config::Environment::default().separator("__"))
        .build()?;

    settings.try_deserialize::<Settings>()
}

enum Environment {
    Local,
    Production,
}

impl Environment {
    fn as_str(&self) -> &'static str {
        match self {
            Environment::Local => "local",
            Environment::Production => "production",
        }
    }
}

impl TryFrom<String> for Environment {
    type Error = String;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        match value.to_lowercase().as_str() {
            "local" => Ok(Self::Local),
            "production" => Ok(Self::Production),
            other => Err(format!(
                "{other} is not a supported environment. \
                Use either `local` or `production`."
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use simplex::provider::SimplicityNetwork;

    use super::{EsploraSettings, Settings};

    #[test]
    fn base_yaml_deserializes() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("configuration")
            .join("base.yaml");

        let settings = config::Config::builder()
            .add_source(config::File::from(path))
            .build()
            .expect("load base.yaml")
            .try_deserialize::<Settings>()
            .expect("deserialize Settings");

        assert_eq!(settings.schedule.interval_secs, 86400);
        assert_eq!(settings.harvest.max_vaults_per_tx, 10);
        assert!(settings.collector.outpoint.is_none());
        assert!(settings.withdraw.destination_address.is_empty());
        assert_eq!(
            settings.esplora.simplicity_network().unwrap(),
            SimplicityNetwork::LiquidTestnet
        );
    }

    #[test]
    fn simplicity_network_rejects_unknown_value() {
        let settings = EsploraSettings {
            base_url: "http://localhost".to_owned(),
            network: "mainnet".to_owned(),
        };

        assert!(settings.simplicity_network().is_err());
    }
}
