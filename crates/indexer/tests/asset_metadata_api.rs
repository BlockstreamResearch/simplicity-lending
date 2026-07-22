//! Integration tests for the `.well-known` asset domain proof endpoint.

mod common;

use lending_indexer::api::server::run_server;
use reqwest::StatusCode;
use serial_test::serial;
use tokio::net::TcpListener;
use uuid::Uuid;

use crate::common::{factory_model, seed_factory_row, test_pool, unique_32_bytes_from_uuid};

#[tokio::test]
#[serial]
async fn serves_domain_proof_only_for_indexed_factory_assets() -> anyhow::Result<()> {
    let pool = test_pool().await?;

    let factory_id = Uuid::new_v4();
    let mut factory = factory_model(factory_id, 100, unique_32_bytes_from_uuid(factory_id));
    factory.factory_asset_id = vec![0xab; 32];
    seed_factory_row(&pool, &factory).await?;

    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let base_url = format!("http://{}", listener.local_addr()?);
    let server = tokio::spawn(run_server(listener, pool));

    let http = reqwest::Client::new();
    let asset_id = "ab".repeat(32);
    let proof = http
        .get(format!(
            "{base_url}/.well-known/liquid-asset-proof-{asset_id}"
        ))
        .send()
        .await?;
    assert_eq!(proof.status(), StatusCode::OK);
    // The proof names the request host (what the registry connects to).
    assert_eq!(
        proof.text().await?,
        format!("Authorize linking the domain name 127.0.0.1 to the Liquid asset {asset_id}")
    );

    for missing in [
        format!("liquid-asset-proof-{}", "00".repeat(32)), // unknown asset
        "liquid-asset-proof-nothex".to_string(),           // malformed asset id
        "security.txt".to_string(),                        // unrelated well-known file
    ] {
        let response = http
            .get(format!("{base_url}/.well-known/{missing}"))
            .send()
            .await?;
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{missing}");
    }

    server.abort();
    Ok(())
}
