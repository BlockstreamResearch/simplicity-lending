use lending_indexer::configuration::{EsploraSettings, Network};
use lending_indexer::indexer::{ChainSource, EsploraChainSource};
use simplex::simplicityhl::elements::{LockTime, Transaction, TxIn, TxOut, encode};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const BLOCK_HASH: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const PARENT_HASH: &str = "2222222222222222222222222222222222222222222222222222222222222222";

fn chain_for(server: &MockServer) -> EsploraChainSource {
    EsploraChainSource::new(&EsploraSettings {
        base_url: format!("{}/", server.uri()),
        timeout: 5,
        network: Network::LiquidTestnet,
    })
}

fn tx(lock_time: u32) -> Transaction {
    Transaction {
        version: 2,
        lock_time: LockTime::from_consensus(lock_time),
        input: vec![TxIn::default()],
        output: vec![TxOut::default()],
    }
}

async fn mock_text(server: &MockServer, url_path: &str, body: impl Into<String>) {
    Mock::given(method("GET"))
        .and(path(url_path.to_owned()))
        .respond_with(ResponseTemplate::new(200).set_body_string(body.into()))
        .mount(server)
        .await;
}

#[tokio::test]
async fn reads_tip_height_and_block_hash() -> anyhow::Result<()> {
    let server = MockServer::start().await;
    mock_text(&server, "/blocks/tip/height", "2709600").await;
    mock_text(&server, "/block-height/2709599", BLOCK_HASH).await;
    let chain = chain_for(&server);

    assert_eq!(chain.tip_height().await?, 2_709_600);
    assert_eq!(chain.block_hash_at(2_709_599).await?, BLOCK_HASH);

    Ok(())
}

#[tokio::test]
async fn reads_block_parent_hash() -> anyhow::Result<()> {
    let server = MockServer::start().await;
    mock_text(
        &server,
        &format!("/block/{BLOCK_HASH}"),
        format!(r#"{{"id":"{BLOCK_HASH}","height":2709600,"previousblockhash":"{PARENT_HASH}"}}"#),
    )
    .await;

    assert_eq!(
        chain_for(&server).block_parent_hash(BLOCK_HASH).await?,
        PARENT_HASH
    );

    Ok(())
}

#[tokio::test]
async fn block_without_parent_is_an_error() {
    let server = MockServer::start().await;
    mock_text(
        &server,
        &format!("/block/{BLOCK_HASH}"),
        format!(r#"{{"id":"{BLOCK_HASH}","height":0,"previousblockhash":null}}"#),
    )
    .await;

    assert!(
        chain_for(&server)
            .block_parent_hash(BLOCK_HASH)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn unknown_block_parent_is_an_error() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(format!("/block/{BLOCK_HASH}")))
        .respond_with(ResponseTemplate::new(404).set_body_string("Block not found"))
        .mount(&server)
        .await;

    assert!(
        chain_for(&server)
            .block_parent_hash(BLOCK_HASH)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn reads_block_transactions_in_block_order() -> anyhow::Result<()> {
    let server = MockServer::start().await;
    let txs = [tx(1), tx(2)];
    mock_text(
        &server,
        &format!("/block/{BLOCK_HASH}/txids"),
        serde_json::to_string(
            &txs.iter()
                .map(|tx| tx.txid().to_string())
                .collect::<Vec<_>>(),
        )?,
    )
    .await;
    for tx in &txs {
        Mock::given(method("GET"))
            .and(path(format!("/tx/{}/raw", tx.txid())))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(encode::serialize(tx)))
            .mount(&server)
            .await;
    }

    assert_eq!(chain_for(&server).block_txs(BLOCK_HASH).await?, txs);

    Ok(())
}
