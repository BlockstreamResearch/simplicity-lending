#[derive(serde::Deserialize)]
pub struct Settings {
    pub database: DatabaseSettings,
    pub esplora: EsploraSettings,
    pub indexer: IndexerSettings,
    pub application: ApplicationSettings,
}

#[derive(serde::Deserialize)]
pub struct ApplicationSettings {
    pub port: u16,
    pub host: String,
    #[serde(default)]
    pub cors: CorsSettings,
}

#[derive(serde::Deserialize, Clone)]
pub struct CorsSettings {
    #[serde(default = "default_cors_allowed_origins")]
    pub allowed_origins: Vec<String>,
}

impl Default for CorsSettings {
    fn default() -> Self {
        Self {
            allowed_origins: default_cors_allowed_origins(),
        }
    }
}

fn default_cors_allowed_origins() -> Vec<String> {
    vec!["*".to_string()]
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
    pub last_indexed_height: u64,
}

pub fn get_configuration() -> Result<Settings, config::ConfigError> {
    let base_path = std::env::current_dir().expect("Failed to determine the current directory");
    let configuration_directory = base_path.join("configuration");

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
        .build()?;

    settings.try_deserialize::<Settings>()
}

pub enum Environment {
    Local,
    Production,
}

impl Environment {
    pub fn as_str(&self) -> &'static str {
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
                "{} is not a supported environment. \
                Use either `local` or `production`.",
                other
            )),
        }
    }
}
