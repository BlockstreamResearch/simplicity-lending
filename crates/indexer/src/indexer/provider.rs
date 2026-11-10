use std::sync::Arc;

use simplex::provider::{EsploraProvider, ProviderError};

/// Runs a blocking call to the Simplex Esplora provider off the async runtime.
pub(crate) async fn call_provider<T, F>(
    provider: &Arc<EsploraProvider>,
    call: F,
) -> anyhow::Result<T>
where
    T: Send + 'static,
    F: FnOnce(&EsploraProvider) -> Result<T, ProviderError> + Send + 'static,
{
    let provider = Arc::clone(provider);

    Ok(tokio::task::spawn_blocking(move || call(&provider)).await??)
}
