use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::HeaderMap;

use crate::api::openapi::ErrorResponse;
use crate::api::utils::parse_filter_hex;
use crate::api::{ApiError, AppState};

/// Serves the HTTP domain proof asset registries fetch during domain
/// verification (`https://<domain>/.well-known/liquid-asset-proof-<asset_id>`), for any indexed factory asset.
///
/// The domain named in the text is the request host.
/// The registry fetches the proof from the very domain it is verifying, so no configuration is involved.
/// A forged Host yields a response served from this origin, which proves nothing for any other domain.
/// Verifying asset metadata is the wallets' responsibility.
#[utoipa::path(
    get,
    path = "/.well-known/{proof_file}",
    tag = "assets",
    params((
        "proof_file" = String,
        Path,
        description = "Proof file name in the form `liquid-asset-proof-<asset_id>`"
    )),
    responses(
        (status = 200, description = "Domain proof for an indexed factory asset", body = String),
        (status = 404, description = "Not a known factory asset", body = ErrorResponse),
    )
)]
#[tracing::instrument(name = "Serving asset domain proof", skip(state, headers))]
pub async fn get_domain_proof(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(proof_file): Path<String>,
) -> Result<String, ApiError> {
    let not_found = || ApiError::NotFound(proof_file.clone());

    let asset_id = proof_file
        .strip_prefix("liquid-asset-proof-")
        .map(str::to_ascii_lowercase)
        .filter(|id| id.len() == 64)
        .ok_or_else(not_found)?;
    let asset_id_bytes = parse_filter_hex(&asset_id).ok_or_else(not_found)?;
    let domain = headers
        .get("host")
        .and_then(|value| value.to_str().ok())
        .and_then(|host| host.split(':').next())
        .filter(|host| !host.is_empty())
        .ok_or_else(not_found)?;

    let known = sqlx::query_scalar!(
        "SELECT id FROM factories WHERE factory_asset_id = $1 LIMIT 1",
        asset_id_bytes,
    )
    .fetch_optional(&state.db)
    .await?
    .is_some();

    if !known {
        return Err(not_found());
    }

    Ok(format!(
        "Authorize linking the domain name {domain} to the Liquid asset {asset_id}"
    ))
}
