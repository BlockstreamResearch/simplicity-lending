use std::time::Duration;

use lending_session::indexer::{
    FactoryStatus, IndexerClient, IndexerClientConfig, IndexerClientError, OfferListParams,
    OfferSortBy, OfferStatus, ParticipantType, SortDir, UtxoType,
};
use uuid::Uuid;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

const OFFER_ID: &str = "11111111-1111-1111-1111-111111111111";
const FACTORY_ID: &str = "22222222-2222-2222-2222-222222222222";

async fn client_for(server: &MockServer) -> IndexerClient {
    IndexerClient::new(server.uri()).expect("build client")
}

fn offer_list_body() -> String {
    format!(
        r#"{{
            "items": [
                {{
                    "id": "{OFFER_ID}",
                    "issuance_factory_id": "{FACTORY_ID}",
                    "status": "active",
                    "collateral_asset": "030201",
                    "principal_asset": "060504",
                    "collateral_amount": "1000",
                    "principal_amount": "500",
                    "interest_rate": 250,
                    "loan_expiration_height": 123,
                    "created_at_height": 456,
                    "created_at_txid": "ccbbaa",
                    "participants": []
                }}
            ],
            "total": 1,
            "limit": 50,
            "offset": 0
        }}"#
    )
}

#[tokio::test]
async fn list_offers_parses_paginated_response() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/offers"))
        .respond_with(ResponseTemplate::new(200).set_body_string(offer_list_body()))
        .mount(&server)
        .await;

    let client = client_for(&server).await;
    let response = client
        .list_offers(&OfferListParams::new())
        .await
        .expect("list offers");

    assert_eq!(response.total, 1);
    assert_eq!(response.limit, 50);
    assert_eq!(response.offset, 0);
    assert_eq!(response.items.len(), 1);

    let item = &response.items[0];
    assert_eq!(item.id, Uuid::parse_str(OFFER_ID).unwrap());
    assert_eq!(item.status, OfferStatus::Active);
    assert_eq!(item.collateral_amount, "1000");
    assert_eq!(item.interest_rate, 250);
    assert!(item.participants.is_empty());
    assert!(item.borrower_principal_utxo.is_none());
}

#[tokio::test]
async fn list_offers_forwards_filter_query_params() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/offers"))
        .and(query_param("status", "pending,active"))
        .and(query_param("limit", "10"))
        .and(query_param("offset", "5"))
        .and(query_param("sort_by", "loan_expiration_height"))
        .and(query_param("sort_dir", "asc"))
        .respond_with(ResponseTemplate::new(200).set_body_string(offer_list_body()))
        .mount(&server)
        .await;

    let params = OfferListParams::new()
        .with_status(vec![OfferStatus::Pending, OfferStatus::Active])
        .with_limit(10)
        .with_offset(5)
        .with_sort(OfferSortBy::LoanExpirationHeight, SortDir::Asc);

    let client = client_for(&server).await;
    let response = client.list_offers(&params).await.expect("filtered offers");
    assert_eq!(response.total, 1);
}

#[tokio::test]
async fn list_borrower_offers_forwards_script_pubkey() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/borrowers/offers"))
        .and(query_param("script_pubkey", "0014abcd"))
        .respond_with(ResponseTemplate::new(200).set_body_string(offer_list_body()))
        .mount(&server)
        .await;

    let client = client_for(&server).await;
    let response = client
        .list_borrower_offers("0014abcd", &OfferListParams::new())
        .await
        .expect("borrower offers");
    assert_eq!(response.items.len(), 1);
}

#[tokio::test]
async fn get_offer_parses_flattened_details_with_duplicate_participants_key() {
    let body = format!(
        r#"{{
            "id": "{OFFER_ID}",
            "issuance_factory_id": "{FACTORY_ID}",
            "status": "pending",
            "collateral_asset": "0201",
            "principal_asset": "0403",
            "collateral_amount": "99",
            "principal_amount": "77",
            "interest_rate": 12,
            "loan_expiration_height": 321,
            "created_at_height": 55,
            "created_at_txid": "adde",
            "participants": [],
            "borrower_nft_asset": "0a09",
            "lender_nft_asset": "0c0b",
            "protocol_fee_keeper_asset": "2c0b",
            "participants": [
                {{
                    "offer_id": "{OFFER_ID}",
                    "participant_type": "borrower",
                    "script_pubkey": "51ac",
                    "txid": "030201",
                    "vout": 4,
                    "created_at_height": 500,
                    "spent_txid": "bbaa",
                    "spent_at_height": 777
                }}
            ],
            "utxos": [
                {{
                    "offer_id": "{OFFER_ID}",
                    "txid": "030201",
                    "vout": 7,
                    "utxo_type": "repayment",
                    "created_at_height": 123,
                    "spent_txid": "bbaa",
                    "spent_at_height": 456
                }}
            ]
        }}"#
    );

    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(format!("/offers/{OFFER_ID}")))
        .respond_with(ResponseTemplate::new(200).set_body_string(body))
        .mount(&server)
        .await;

    let client = client_for(&server).await;
    let details = client
        .get_offer(Uuid::parse_str(OFFER_ID).unwrap())
        .await
        .expect("offer details");

    assert_eq!(details.info.base.status, OfferStatus::Pending);
    assert_eq!(details.info.borrower_nft_asset, "0a09");
    // Flattened short-item participants stay empty; the real list is top-level.
    assert!(details.info.base.participants.is_empty());
    assert_eq!(details.participants.len(), 1);
    assert_eq!(
        details.participants[0].participant_type,
        ParticipantType::Borrower
    );
    assert_eq!(details.participants[0].spent_at_height, Some(777));
    assert_eq!(details.utxos.len(), 1);
    assert_eq!(details.utxos[0].utxo_type, UtxoType::Repayment);
}

#[tokio::test]
async fn get_offer_ids_by_script_parses_uuid_list() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/offers/by-script"))
        .and(query_param("script_pubkey", "0014abcd"))
        .respond_with(ResponseTemplate::new(200).set_body_string(format!(r#"["{OFFER_ID}"]"#)))
        .mount(&server)
        .await;

    let client = client_for(&server).await;
    let ids = client
        .get_offer_ids_by_script("0014abcd")
        .await
        .expect("offer ids");
    assert_eq!(ids, vec![Uuid::parse_str(OFFER_ID).unwrap()]);
}

#[tokio::test]
async fn get_factory_parses_details_with_utxos() {
    let body = format!(
        r#"{{
            "id": "{FACTORY_ID}",
            "factory_asset_id": "0201",
            "program_script_pubkey": "51ac",
            "status": "active",
            "issuing_utxos_count": 2,
            "reissuance_flags": 0,
            "created_at_height": 100,
            "created_at_txid": "bbaa",
            "auth_utxo": {{
                "txid": "2211",
                "vout": 0,
                "script_pubkey": "3344",
                "created_at_height": 100
            }},
            "program_utxo": {{
                "txid": "6655",
                "vout": 1,
                "created_at_height": 100
            }}
        }}"#
    );

    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(format!("/factories/{FACTORY_ID}")))
        .respond_with(ResponseTemplate::new(200).set_body_string(body))
        .mount(&server)
        .await;

    let client = client_for(&server).await;
    let factory = client
        .get_factory(Uuid::parse_str(FACTORY_ID).unwrap())
        .await
        .expect("factory details");

    assert_eq!(factory.status, FactoryStatus::Active);
    assert_eq!(factory.issuing_utxos_count, 2);
    assert_eq!(factory.auth_utxo.expect("auth utxo").script_pubkey, "3344");
    assert_eq!(factory.program_utxo.expect("program utxo").vout, 1);
}

#[tokio::test]
async fn get_offers_overview_parses_asset_amounts() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/offers/overview"))
        .respond_with(ResponseTemplate::new(200).set_body_string(
            r#"{"collateral_locked":[{"asset":"aa","amount":"100"}],"active_loan_principal":[],"active_loans_count":3}"#,
        ))
        .mount(&server)
        .await;

    let client = client_for(&server).await;
    let overview = client.get_offers_overview().await.expect("overview");
    assert_eq!(overview.active_loans_count, 3);
    assert_eq!(overview.collateral_locked.len(), 1);
    assert_eq!(overview.collateral_locked[0].amount, "100");
    assert!(overview.active_loan_principal.is_empty());
}

#[tokio::test]
async fn not_found_maps_to_not_found_error() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(format!("/offers/{OFFER_ID}")))
        .respond_with(
            ResponseTemplate::new(404).set_body_string(
                r#"{"error":{"code":"not_found","message":"Resource not found: x"}}"#,
            ),
        )
        .mount(&server)
        .await;

    let client = client_for(&server).await;
    let error = client
        .get_offer(Uuid::parse_str(OFFER_ID).unwrap())
        .await
        .expect_err("expected not found");

    match error {
        IndexerClientError::NotFound(message) => {
            assert_eq!(message, "Resource not found: x");
        }
        other => panic!("expected NotFound, got {other:?}"),
    }
}

#[tokio::test]
async fn server_error_maps_to_api_error() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/offers/overview"))
        .respond_with(ResponseTemplate::new(500).set_body_string(
            r#"{"error":{"code":"internal_error","message":"An unexpected error occurred"}}"#,
        ))
        .mount(&server)
        .await;

    let client = client_for(&server).await;
    let error = client
        .get_offers_overview()
        .await
        .expect_err("expected api error");

    match error {
        IndexerClientError::Api {
            status,
            code,
            message,
        } => {
            assert_eq!(status, 500);
            assert_eq!(code, "internal_error");
            assert_eq!(message, "An unexpected error occurred");
        }
        other => panic!("expected Api error, got {other:?}"),
    }
}

#[tokio::test]
async fn invalid_json_maps_to_decode_error() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/offers/overview"))
        .respond_with(ResponseTemplate::new(200).set_body_string("definitely not json"))
        .mount(&server)
        .await;

    let client = client_for(&server).await;
    let error = client
        .get_offers_overview()
        .await
        .expect_err("expected decode error");

    assert!(matches!(error, IndexerClientError::Decode(_)));
}

#[tokio::test]
async fn slow_response_maps_to_timeout_error() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/offers/overview"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_delay(Duration::from_millis(500))
                .set_body_string("{}"),
        )
        .mount(&server)
        .await;

    let config = IndexerClientConfig::new(server.uri()).with_timeout(Duration::from_millis(50));
    let client = IndexerClient::with_config(config).expect("build client");

    let error = client
        .get_offers_overview()
        .await
        .expect_err("expected timeout");

    assert!(matches!(error, IndexerClientError::Timeout));
}
