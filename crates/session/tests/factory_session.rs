use lending_session::{IndexerClient, IndexerClientError, Session, SessionError};
use simplex::provider::{EsploraProvider, SimplicityNetwork};
use simplex::signer::Signer;
use simplex::simplicityhl::elements::Txid;
use simplex::simplicityhl::elements::hex::ToHex;
use wiremock::matchers::{any, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

const TEST_MNEMONIC: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

fn build_signer(provider_url: String) -> Signer {
    Signer::new(
        TEST_MNEMONIC,
        Box::new(EsploraProvider::new(
            provider_url,
            SimplicityNetwork::LiquidTestnet,
        )),
    )
}

fn build_session(indexer_url: &str, provider_url: &str) -> Session {
    let provider = EsploraProvider::new(provider_url.to_owned(), SimplicityNetwork::LiquidTestnet);
    let signer = build_signer(provider_url.to_owned());
    let indexer = IndexerClient::new(indexer_url).expect("build indexer client");
    Session::new(provider, signer, indexer)
}

#[test]
fn session_into_parts_returns_indexer_and_keeps_network() {
    let session = build_session("http://127.0.0.1:3002", "http://127.0.0.1:3001");
    assert_eq!(session.network(), SimplicityNetwork::LiquidTestnet);
    assert_eq!(session.indexer().base_url(), "http://127.0.0.1:3002");

    let (provider, signer, indexer) = session.into_parts();
    assert_eq!(provider.network, SimplicityNetwork::LiquidTestnet);
    assert!(!signer.get_address().script_pubkey().to_hex().is_empty());
    assert_eq!(indexer.base_url(), "http://127.0.0.1:3002");
}

#[tokio::test]
async fn create_factory_returns_borrower_exists_error_when_factory_already_exists() {
    let provider_server = MockServer::start().await;
    let indexer_server = MockServer::start().await;

    let signer = build_signer(provider_server.uri());
    let script_hex = signer.get_address().script_pubkey().to_hex();

    Mock::given(method("GET"))
        .and(path("/factories/by-script"))
        .and(query_param("script_pubkey", script_hex.as_str()))
        .respond_with(ResponseTemplate::new(200).set_body_string(
            r#"[{
                "id":"11111111-1111-1111-1111-111111111111",
                "factory_asset_id":"0a0b0c",
                "program_script_pubkey":"51",
                "status":"active",
                "issuing_utxos_count":2,
                "reissuance_flags":0,
                "created_at_height":123,
                "created_at_txid":"abcdef",
                "auth_utxo":null,
                "program_utxo":null
            }]"#,
        ))
        .mount(&indexer_server)
        .await;

    let provider = EsploraProvider::new(provider_server.uri(), SimplicityNetwork::LiquidTestnet);
    let indexer = IndexerClient::new(&indexer_server.uri()).expect("build indexer client");
    let session = Session::new(provider, signer, indexer);

    let result = session.create_factory(2, 0).await;
    assert!(matches!(
        result,
        Err(SessionError::BorrowerAccountAlreadyExists)
    ));
}

#[tokio::test]
async fn create_factory_propagates_indexer_api_error() {
    let provider_server = MockServer::start().await;
    let indexer_server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/factories/by-script"))
        .respond_with(
            ResponseTemplate::new(500)
                .set_body_string(r#"{"error":{"code":"internal_error","message":"boom"}}"#),
        )
        .mount(&indexer_server)
        .await;

    let session = build_session(&indexer_server.uri(), &provider_server.uri());
    let error = match session.create_factory(2, 0).await {
        Ok(_) => panic!("expected indexer error"),
        Err(error) => error,
    };

    match error {
        SessionError::Indexer(IndexerClientError::Api {
            status,
            code,
            message,
        }) => {
            assert_eq!(status, 500);
            assert_eq!(code, "internal_error");
            assert_eq!(message, "boom");
        }
        other => panic!("expected indexer api error, got {other:?}"),
    }
}

#[tokio::test]
async fn create_factory_returns_no_policy_utxos_when_wallet_is_empty() {
    let provider_server = MockServer::start().await;
    let indexer_server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/factories/by-script"))
        .respond_with(ResponseTemplate::new(200).set_body_string("[]"))
        .mount(&indexer_server)
        .await;

    Mock::given(any())
        .respond_with(ResponseTemplate::new(200).set_body_string("[]"))
        .mount(&provider_server)
        .await;

    let session = build_session(&indexer_server.uri(), &provider_server.uri());
    let result = session.create_factory(2, 0).await;
    assert!(matches!(result, Err(SessionError::NoPolicyUtxos)));
}

#[test]
fn remove_factory_returns_provider_error_when_creation_tx_cannot_be_fetched() {
    let session = build_session("http://127.0.0.1:3002", "http://127.0.0.1:1");
    let creation_txid: Txid = "0000000000000000000000000000000000000000000000000000000000000000"
        .parse()
        .expect("valid txid");

    let result = session.remove_factory(creation_txid);
    assert!(matches!(result, Err(SessionError::Provider(_))));
}
