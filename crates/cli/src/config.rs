use simplex::provider::SimplicityNetwork;

pub const MNEMONIC_ENV_KEY: &str = "MNEMONIC";
pub const ESPLORA_URL_ENV_KEY: &str = "ESPLORA_URL";
pub const NETWORK_ENV_KEY: &str = "NETWORK";

#[derive(Debug, Clone)]
pub struct CliConfig {
    pub mnemonic: String,
    pub esplora_url: String,
    pub network: SimplicityNetwork,
}

impl CliConfig {
    pub fn load_config() -> Self {
        let mnemonic = std::env::var(MNEMONIC_ENV_KEY)
            .expect("Please specify the mnemonic in the .env file using the 'MNEMONIC' key.");
        let esplora_url = std::env::var(ESPLORA_URL_ENV_KEY)
            .expect("Please specify the Esplora URL in the .env file using the 'ESPLORA_URL' key.");
        let network: ConfigNetwork = std::env::var(NETWORK_ENV_KEY)
            .expect("Please specify the network in the .env file using the 'NETWORK' key.")
            .try_into()
            .expect("Failed to parse network value.");

        Self {
            mnemonic,
            esplora_url,
            network: network.into(),
        }
    }
}

enum ConfigNetwork {
    Liquid,
    LiquidTestnet,
    ElementsRegtest,
}

impl TryFrom<String> for ConfigNetwork {
    type Error = String;

    fn try_from(value: String) -> Result<Self, Self::Error> { // TODO
        match value.as_str() {
            "Liquid" => Ok(Self::Liquid),
            "LiquidTestnet" => Ok(Self::LiquidTestnet),
            "ElementsRegtest" => Ok(Self::ElementsRegtest),
            other => Err(format!("Unsupported network name: {other}")),
        }
    }
}

impl From<ConfigNetwork> for SimplicityNetwork {
    fn from(value: ConfigNetwork) -> Self {
        match value {
            ConfigNetwork::Liquid => SimplicityNetwork::Liquid,
            ConfigNetwork::LiquidTestnet => SimplicityNetwork::LiquidTestnet,
            ConfigNetwork::ElementsRegtest => SimplicityNetwork::default_regtest(),
        }
    }
}
