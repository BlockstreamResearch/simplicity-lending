use std::path::{Path, PathBuf};

use simplex::{provider::SimplicityNetwork, simplicityhl::elements::AssetId};

#[derive(serde::Deserialize)]
pub struct Settings {
    pub application: ApplicationSettings,
    pub database: DatabaseSettings,
    pub esplora: EsploraSettings,
    pub indexer: IndexerSettings,
}

#[derive(serde::Deserialize)]
pub struct ApplicationSettings {
    pub port: u16,
    pub host: String,
}

#[derive(serde::Deserialize, Clone)]
pub struct DatabaseSettings {
    /// Postgres connection string, taken from `DATABASE_URL`.
    pub url: String,
}

#[derive(serde::Deserialize, Clone)]
pub struct EsploraSettings {
    pub base_url: String,
    pub timeout: u16,
    pub network: Network,
}

/// ELIP-0100 asset metadata registration for factory assets issued by the lending flow.
/// Disabled while `domain` is unset.
#[derive(serde::Deserialize, Clone, Default)]
pub struct AssetRegistrySettings {
    /// Issuer domain committed in asset contracts (the deployment's public origin.
    /// The `.well-known` proof route echoes the request host).
    #[serde(default)]
    pub domain: Option<String>,
    /// Asset registry base URL, e.g. `https://assets-testnet.blockstream.info`.
    #[serde(default)]
    pub registry_url: Option<String>,
}

#[derive(serde::Deserialize, Clone)]
pub struct IndexerSettings {
    pub protocol_fee_keeper_asset_id: AssetId,
    pub interval: u64,
    pub last_indexed_height: u64,
    #[serde(default)]
    pub asset_registry: AssetRegistrySettings,
}

impl Settings {
    /// Reads `base.yaml`, then applies `INDEXER_*` overrides and the required `DATABASE_URL`.
    pub fn load() -> Result<Self, config::ConfigError> {
        Self::load_from(
            &Self::configuration_dir(Self::indexer_configuration_dir().as_deref()),
            Self::environment_source(),
            Self::database_url(),
        )
    }

    fn load_from(
        directory: &Path,
        environment: config::Environment,
        database_url: Option<String>,
    ) -> Result<Self, config::ConfigError> {
        // `DATABASE_URL` is shared with sqlx-cli and the integration tests, so it is read unprefixed.
        let database_url = database_url
            .filter(|url| !url.trim().is_empty())
            .ok_or_else(|| config::ConfigError::NotFound("DATABASE_URL".into()))?;

        config::Config::builder()
            .add_source(config::File::from(directory.join("base.yaml")))
            .add_source(environment)
            .set_override("database.url", database_url)?
            .build()?
            .try_deserialize()
    }

    /// `override_path` (from `INDEXER_CONFIGURATION_DIR`) wins over `./configuration`.
    fn configuration_dir(override_path: Option<&str>) -> PathBuf {
        override_path
            .map(str::trim)
            .filter(|path| !path.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                std::env::current_dir()
                    .expect("Failed to determine the current directory")
                    .join("configuration")
            })
    }

    /// `INDEXER_<SECTION>__<KEY>` overrides `base.yaml`, e.g. `INDEXER_ESPLORA__BASE_URL`.
    fn environment_source() -> config::Environment {
        config::Environment::with_prefix("INDEXER")
            .prefix_separator("_")
            .separator("__")
    }

    fn indexer_configuration_dir() -> Option<String> {
        std::env::var("INDEXER_CONFIGURATION_DIR").ok()
    }

    fn database_url() -> Option<String> {
        std::env::var("DATABASE_URL").ok()
    }
}

#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(try_from = "String")]
pub enum Network {
    Liquid,
    LiquidTestnet,
    Regtest,
}

impl TryFrom<String> for Network {
    type Error = String;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        match value.to_lowercase().as_str() {
            "liquid" => Ok(Self::Liquid),
            "liquidtestnet" => Ok(Self::LiquidTestnet),
            "regtest" => Ok(Self::Regtest),
            other => Err(format!(
                "{} is not a supported network. \
                Use `liquid`, `liquidtestnet` or `regtest`.",
                other
            )),
        }
    }
}

impl From<Network> for SimplicityNetwork {
    fn from(value: Network) -> Self {
        match value {
            Network::Liquid => SimplicityNetwork::Liquid,
            Network::LiquidTestnet => SimplicityNetwork::LiquidTestnet,
            Network::Regtest => SimplicityNetwork::default_regtest(),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use simplex::provider::SimplicityNetwork;

    use super::{Network, Settings};

    const DATABASE_URL: &str = "postgres://postgres:password@localhost:5432/lending-indexer";

    fn configuration_dir() -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("configuration")
    }

    fn load_with_env(vars: &[(&str, &str)]) -> Result<Settings, config::ConfigError> {
        let vars = vars
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect::<HashMap<_, _>>();

        Settings::load_from(
            &configuration_dir(),
            Settings::environment_source().source(Some(vars)),
            Some(DATABASE_URL.to_owned()),
        )
    }

    #[test]
    fn base_yaml_deserializes() {
        let settings = load_with_env(&[]).expect("load base.yaml");

        assert_eq!(settings.database.url, DATABASE_URL);
        assert_eq!(settings.application.host, "127.0.0.1");
        assert_eq!(settings.application.port, 8000);
        assert_eq!(
            settings.esplora.base_url,
            "https://liquid.network/liquidtestnet/api"
        );
        assert!(matches!(settings.esplora.network, Network::LiquidTestnet));
        assert_eq!(settings.indexer.interval, 10000);
        assert!(settings.indexer.asset_registry.domain.is_none());
    }

    #[test]
    fn indexer_environment_overrides_base_yaml() {
        let settings = load_with_env(&[
            ("INDEXER_APPLICATION__HOST", "0.0.0.0"),
            ("INDEXER_ESPLORA__NETWORK", "liquid"),
            ("INDEXER_INDEXER__INTERVAL", "500"),
            (
                "INDEXER_INDEXER__ASSET_REGISTRY__DOMAIN",
                "lending.example.com",
            ),
            ("INDEXER_INDEXER__ASSET_REGISTRY__REGISTRY_URL", ""),
            ("APPLICATION__PORT", "1"),
        ])
        .expect("load configuration");

        assert_eq!(settings.application.host, "0.0.0.0");
        assert_eq!(settings.application.port, 8000);
        assert!(matches!(settings.esplora.network, Network::Liquid));
        assert_eq!(settings.indexer.interval, 500);
        assert_eq!(
            settings.indexer.asset_registry.domain.as_deref(),
            Some("lending.example.com")
        );
        assert_eq!(
            settings.indexer.asset_registry.registry_url.as_deref(),
            Some("")
        );
    }

    #[test]
    fn database_url_is_required() {
        for database_url in [None, Some("  ".to_owned())] {
            let error = Settings::load_from(
                &configuration_dir(),
                Settings::environment_source().source(Some(HashMap::new())),
                database_url,
            )
            .err()
            .expect("missing DATABASE_URL");

            assert!(error.to_string().contains("DATABASE_URL"), "{error}");
        }
    }

    #[test]
    fn unknown_network_is_rejected_on_load() {
        let error = load_with_env(&[("INDEXER_ESPLORA__NETWORK", "mainnet")])
            .err()
            .expect("unknown network");

        assert!(
            error.to_string().contains("not a supported network"),
            "{error}"
        );
    }

    #[test]
    fn configuration_dir_prefers_the_environment_override() {
        let default_dir = std::env::current_dir()
            .expect("current dir")
            .join("configuration");

        assert_eq!(Settings::configuration_dir(None), default_dir);
        assert_eq!(Settings::configuration_dir(Some("  ")), default_dir);
        assert_eq!(
            Settings::configuration_dir(Some("/etc/indexer")),
            std::path::PathBuf::from("/etc/indexer")
        );
    }

    #[test]
    fn network_try_from_is_case_insensitive() {
        assert!(matches!(
            Network::try_from("Liquid".to_string()),
            Ok(Network::Liquid)
        ));
        assert!(matches!(
            Network::try_from("LIQUIDTESTNET".to_string()),
            Ok(Network::LiquidTestnet)
        ));
        assert!(matches!(
            Network::try_from("regtest".to_string()),
            Ok(Network::Regtest)
        ));
    }

    #[test]
    fn network_try_from_invalid_returns_error() {
        let result = Network::try_from("mainnet".to_string());
        assert!(result.is_err());
        let err = result.err().unwrap_or_default();
        assert!(err.contains("not a supported network"));
    }

    #[test]
    fn network_into_simplicity_network() {
        let liquid: SimplicityNetwork = Network::Liquid.into();
        assert_eq!(liquid, SimplicityNetwork::Liquid);

        let testnet: SimplicityNetwork = Network::LiquidTestnet.into();
        assert_eq!(testnet, SimplicityNetwork::LiquidTestnet);

        let regtest: SimplicityNetwork = Network::Regtest.into();
        assert_eq!(regtest, SimplicityNetwork::default_regtest());
    }
}
