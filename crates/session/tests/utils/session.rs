use lending_session::{IndexerClient, Session};
use simplex::provider::{EsploraProvider, ProviderTrait, SimplexProvider};
use simplex::signer::Signer;
use sqlx::PgPool;

use super::db::setup_test_pool;

fn context_config_path() -> std::path::PathBuf {
    std::env::temp_dir().join(format!("session-test-{}.toml", uuid::Uuid::new_v4()))
}

fn new_context() -> anyhow::Result<simplex::TestContext> {
    let config_path = context_config_path();
    simplex::TestConfig::default().to_file(&config_path)?;
    let context = simplex::TestContext::new(config_path.clone())
        .map_err(|e| anyhow::anyhow!("failed to initialize simplex test context: {e}"))?;
    let _ = std::fs::remove_file(config_path);
    Ok(context)
}

fn esplora_url_from_signer(signer: &Signer) -> String {
    let provider = signer.get_provider();
    let simplex = unsafe { &*(provider as *const dyn ProviderTrait as *const SimplexProvider) };
    simplex.esplora.esplora_url.clone()
}

pub fn build_session(context: &simplex::TestContext, indexer_base_url: &str) -> Session {
    let signer = context.create_signer(&context.get_config().mnemonic);
    build_session_with_signer(context, signer, indexer_base_url)
}

pub fn build_session_with_signer(
    context: &simplex::TestContext,
    signer: Signer,
    indexer_base_url: &str,
) -> Session {
    let provider = EsploraProvider::new(esplora_url_from_signer(&signer), *context.get_network());
    let indexer = IndexerClient::new(indexer_base_url).expect("build indexer client");
    Session::new(provider, signer, indexer)
}

pub async fn setup_it_context_pool() -> anyhow::Result<(simplex::TestContext, PgPool)> {
    let pool = setup_test_pool().await?;
    let context = new_context()?;
    Ok((context, pool))
}
