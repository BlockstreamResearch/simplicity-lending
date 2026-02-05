#[derive(serde::Deserialize)]
pub struct Settings {
    pub database: DatabaseSettings,
    pub esplora: EsploraSettings,
    pub indexer: IndexerSettings,
    pub application_port: u16,
}

#[derive(serde::Deserialize, Clone)]
pub struct DatabaseSettings {
    pub username: String,
    pub password: String,
    pub port: u16,
    pub host: String,
    pub database_name: String,
}

impl DatabaseSettings {
    pub fn connection_string(&self) -> String {
        format!(
            "postgres://{}:{}@{}:{}/{}",
            self.username, self.password, self.host, self.port, self.database_name
        )
    }
}

#[derive(serde::Deserialize, Clone)]
pub struct EsploraSettings {
    pub base_url: String,
    pub timeout: u16,
}

#[derive(serde::Deserialize, Clone)]
pub struct IndexerSettings {
    pub interval: u64,
}

pub fn get_configuration() -> Result<Settings, config::ConfigError> {
    let settings = config::Config::builder()
        .add_source(config::File::new(
            "configuration.yaml",
            config::FileFormat::Yaml,
        ))
        .build()?;

    settings.try_deserialize::<Settings>()
}
