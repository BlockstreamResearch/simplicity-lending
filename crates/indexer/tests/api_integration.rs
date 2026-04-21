mod common;

use std::time::Duration;

use lending_indexer::api::server::run_server;
use lending_indexer::models::{OfferStatus, ParticipantType, UtxoType};
use reqwest::StatusCode;
use serde_json::Value;
use serial_test::serial;
use simplex::simplicityhl::elements::OutPoint;
use sqlx::PgPool;
use tokio::net::TcpListener;
use tokio::time::timeout;
use uuid::Uuid;

use crate::common::{
    FIXED_BORROWER_PUBKEY_HEX, offer_model, outpoint_from_uuid_vout, seed_offer_row,
    seed_offer_utxo_row, seed_participant_utxo_row, spent_offer_utxo, spent_participant, test_pool,
    unique_32_bytes_from_uuid, unspent_offer_utxo, unspent_participant,
};

async fn start_api(pool: PgPool) -> anyhow::Result<(String, tokio::task::JoinHandle<()>)> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let addr = listener.local_addr()?;
    let handle = tokio::spawn(async move {
        run_server(listener, pool).await;
    });
    // Socket is already listening after `bind`; kernel buffers early
    // connection attempts, so no startup sleep is required.
    Ok((format!("http://{addr}"), handle))
}

async fn response_json(response: reqwest::Response) -> anyhow::Result<Value> {
    // `reqwest::Response::json` needs the `json` feature which this crate
    // does not enable.
    let body = response.text().await?;
    Ok(serde_json::from_str(&body)?)
}

async fn get_json(http: &reqwest::Client, url: String) -> anyhow::Result<Value> {
    let response = http.get(url).send().await?.error_for_status()?;
    response_json(response).await
}

async fn post_json(
    http: &reqwest::Client,
    url: String,
    body: Value,
) -> anyhow::Result<reqwest::Response> {
    Ok(http
        .post(url)
        .header("content-type", "application/json")
        .body(body.to_string())
        .send()
        .await?)
}

fn ids_from_objects(value: &Value) -> Vec<String> {
    let mut ids: Vec<String> = value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("id").and_then(Value::as_str))
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default();
    ids.sort();
    ids
}

fn uuid_strings_from_array(value: &Value) -> Vec<String> {
    let mut ids: Vec<String> = value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default();
    ids.sort();
    ids
}

fn assert_ids_match_unordered(value: &Value, expected: &[Uuid]) {
    let mut expected_ids: Vec<String> = expected.iter().map(Uuid::to_string).collect();
    expected_ids.sort();
    assert_eq!(ids_from_objects(value), expected_ids);
}

fn assert_uuid_values_match_unordered(value: &Value, expected: &[Uuid]) {
    let mut expected_ids: Vec<String> = expected.iter().map(Uuid::to_string).collect();
    expected_ids.sort();
    assert_eq!(uuid_strings_from_array(value), expected_ids);
}

/// Canonical offer graph used across most list/detail tests:
/// - spent pre-lock UTXO (vout 0) + current unspent lending UTXO (vout 2);
/// - historical borrower participant (vout 1, `51ac`) + current
///   unspent borrower participant (vout 3, `52ac`).
async fn seed_offer_graph(
    pool: &PgPool,
    offer_id: Uuid,
    status: OfferStatus,
    created_at_height: i64,
) -> anyhow::Result<()> {
    let mut offer = offer_model(
        offer_id,
        created_at_height,
        unique_32_bytes_from_uuid(offer_id),
    );
    offer.current_status = status;
    seed_offer_row(pool, &offer).await?;

    let outpoint = outpoint_from_uuid_vout(offer_id, 0);
    let pre_lock = spent_offer_utxo(
        offer_id,
        outpoint,
        UtxoType::PreLock,
        created_at_height,
        created_at_height + 1,
        0x99,
    );
    let lending = unspent_offer_utxo(
        offer_id,
        OutPoint {
            txid: outpoint.txid,
            vout: 2,
        },
        UtxoType::Lending,
        created_at_height + 2,
    );
    seed_offer_utxo_row(pool, &pre_lock).await?;
    seed_offer_utxo_row(pool, &lending).await?;

    let old_borrower = spent_participant(
        offer_id,
        ParticipantType::Borrower,
        OutPoint {
            txid: outpoint.txid,
            vout: 1,
        },
        vec![0x51, 0xac],
        created_at_height,
        created_at_height + 3,
        0x77,
    );
    let current_borrower = unspent_participant(
        offer_id,
        ParticipantType::Borrower,
        OutPoint {
            txid: outpoint.txid,
            vout: 3,
        },
        vec![0x52, 0xac],
        created_at_height + 4,
    );
    seed_participant_utxo_row(pool, &old_borrower).await?;
    seed_participant_utxo_row(pool, &current_borrower).await?;

    Ok(())
}

const PENDING_OFFER_HEIGHT: i64 = 42;
const ACTIVE_OFFER_HEIGHT: i64 = 43;

async fn setup_seeded_api() -> anyhow::Result<(String, tokio::task::JoinHandle<()>, Uuid, Uuid)> {
    let pool = test_pool().await?;

    let pending_offer = Uuid::new_v4();
    let active_offer = Uuid::new_v4();
    seed_offer_graph(
        &pool,
        pending_offer,
        OfferStatus::Pending,
        PENDING_OFFER_HEIGHT,
    )
    .await?;
    seed_offer_graph(
        &pool,
        active_offer,
        OfferStatus::Active,
        ACTIVE_OFFER_HEIGHT,
    )
    .await?;

    let (base_url, server_handle) = start_api(pool).await?;
    Ok((base_url, server_handle, pending_offer, active_offer))
}

#[tokio::test]
#[serial]
async fn get_offers_returns_all_seeded_offers_with_correct_status() -> anyhow::Result<()> {
    let (base_url, server_handle, pending_offer, active_offer) = setup_seeded_api().await?;
    let http = reqwest::Client::new();

    let json = get_json(&http, format!("{base_url}/offers")).await?;

    assert_eq!(json.as_array().map_or(0, Vec::len), 2);
    assert_ids_match_unordered(&json, &[pending_offer, active_offer]);

    // Pins `ORDER BY created_at_height DESC` (active_offer's height > pending's).
    assert_eq!(json[0]["id"], active_offer.to_string());
    assert_eq!(json[0]["status"], "active");
    assert_eq!(json[1]["id"], pending_offer.to_string());
    assert_eq!(json[1]["status"], "pending");

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn get_offers_full_returns_borrower_pubkey_among_other_fields() -> anyhow::Result<()> {
    let (base_url, server_handle, pending_offer, active_offer) = setup_seeded_api().await?;
    let http = reqwest::Client::new();

    let json = get_json(&http, format!("{base_url}/offers/full")).await?;

    assert_eq!(json.as_array().map_or(0, Vec::len), 2);
    assert_ids_match_unordered(&json, &[pending_offer, active_offer]);
    assert!(json[0]["borrower_pubkey"].as_str().is_some());
    assert!(json[0]["borrower_output_script_hash"].as_str().is_some());

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn get_offer_details_returns_offer_with_latest_participant() -> anyhow::Result<()> {
    let (base_url, server_handle, pending_offer, _active_offer) = setup_seeded_api().await?;
    let http = reqwest::Client::new();

    let json = get_json(&http, format!("{base_url}/offers/{pending_offer}")).await?;

    assert_eq!(json["id"], pending_offer.to_string());
    assert_eq!(json["status"], "pending");
    assert_eq!(json["participants"].as_array().map_or(0, Vec::len), 1);
    assert_eq!(json["participants"][0]["script_pubkey"], "52ac");

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn post_offers_batch_returns_requested_offers() -> anyhow::Result<()> {
    let (base_url, server_handle, pending_offer, active_offer) = setup_seeded_api().await?;
    let http = reqwest::Client::new();

    let response = post_json(
        &http,
        format!("{base_url}/offers/batch"),
        serde_json::json!({ "ids": [pending_offer, active_offer] }),
    )
    .await?
    .error_for_status()?;
    let json = response_json(response).await?;

    assert_eq!(json.as_array().map_or(0, Vec::len), 2);
    assert_ids_match_unordered(&json, &[pending_offer, active_offer]);

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn post_offers_batch_handles_empty_and_partial_ids() -> anyhow::Result<()> {
    let (base_url, server_handle, pending_offer, _active_offer) = setup_seeded_api().await?;
    let http = reqwest::Client::new();

    let empty_response = post_json(
        &http,
        format!("{base_url}/offers/batch"),
        serde_json::json!({ "ids": [] }),
    )
    .await?
    .error_for_status()?;
    let empty = response_json(empty_response).await?;
    assert_eq!(empty.as_array().map_or(0, Vec::len), 0);

    let partial_response = post_json(
        &http,
        format!("{base_url}/offers/batch"),
        serde_json::json!({ "ids": [pending_offer, Uuid::new_v4()] }),
    )
    .await?
    .error_for_status()?;
    let partial = response_json(partial_response).await?;
    assert_eq!(partial.as_array().map_or(0, Vec::len), 1);
    assert_eq!(partial[0]["id"], pending_offer.to_string());

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn get_offers_by_script_returns_only_owners_of_unspent_match() -> anyhow::Result<()> {
    let (base_url, server_handle, pending_offer, active_offer) = setup_seeded_api().await?;
    let http = reqwest::Client::new();

    // `52ac` = current unspent borrower script across both seeded offers;
    // `51ac` = historical spent script, must not leak into the by-script lookup.
    let current = get_json(
        &http,
        format!("{base_url}/offers/by-script?script_pubkey=52ac"),
    )
    .await?;
    assert_eq!(current.as_array().map_or(0, Vec::len), 2);
    assert_uuid_values_match_unordered(&current, &[pending_offer, active_offer]);

    let historical = get_json(
        &http,
        format!("{base_url}/offers/by-script?script_pubkey=51ac"),
    )
    .await?;
    assert_eq!(historical.as_array().map_or(0, Vec::len), 0);

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn get_offers_by_borrower_pubkey_returns_pending_only() -> anyhow::Result<()> {
    let (base_url, server_handle, pending_offer, _active_offer) = setup_seeded_api().await?;
    let http = reqwest::Client::new();

    let json = get_json(
        &http,
        format!("{base_url}/offers/by-borrower-pubkey?borrower_pubkey={FIXED_BORROWER_PUBKEY_HEX}"),
    )
    .await?;

    assert_eq!(json.as_array().map_or(0, Vec::len), 1);
    assert_eq!(json[0], pending_offer.to_string());

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn get_latest_participants_returns_current_snapshot() -> anyhow::Result<()> {
    let (base_url, server_handle, pending_offer, _active_offer) = setup_seeded_api().await?;
    let http = reqwest::Client::new();

    let json = get_json(
        &http,
        format!("{base_url}/offers/{pending_offer}/participants"),
    )
    .await?;

    assert_eq!(json.as_array().map_or(0, Vec::len), 1);
    assert_eq!(json[0]["script_pubkey"], "52ac");
    assert_eq!(json[0]["participant_type"], "borrower");

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn get_participants_history_returns_full_movement_history() -> anyhow::Result<()> {
    let (base_url, server_handle, pending_offer, _active_offer) = setup_seeded_api().await?;
    let http = reqwest::Client::new();

    let json = get_json(
        &http,
        format!("{base_url}/offers/{pending_offer}/participants/history"),
    )
    .await?;

    assert_eq!(json.as_array().map_or(0, Vec::len), 2);
    assert_eq!(json[0]["script_pubkey"], "51ac");
    assert_eq!(
        json[0]["spent_txid"],
        "7777777777777777777777777777777777777777777777777777777777777777"
    );
    assert_eq!(json[1]["script_pubkey"], "52ac");
    assert!(json[1]["spent_txid"].is_null());

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn get_offer_utxos_returns_full_history_ordered_by_height() -> anyhow::Result<()> {
    let (base_url, server_handle, pending_offer, _active_offer) = setup_seeded_api().await?;
    let http = reqwest::Client::new();

    let json = get_json(&http, format!("{base_url}/offers/{pending_offer}/utxos")).await?;

    assert_eq!(json.as_array().map_or(0, Vec::len), 2);
    assert_eq!(json[0]["utxo_type"], "pre_lock");
    assert_eq!(json[0]["spent_at_height"], PENDING_OFFER_HEIGHT + 1);
    assert_eq!(json[1]["utxo_type"], "lending");
    assert!(json[1]["spent_at_height"].is_null());

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn offers_filters_apply_status_asset_pagination_and_order() -> anyhow::Result<()> {
    let pool = test_pool().await?;

    let offer_a = Uuid::new_v4();
    let offer_b = Uuid::new_v4();
    let offer_c = Uuid::new_v4();
    let offer_d = Uuid::new_v4();

    for (id, status, height, collat, princ) in [
        (offer_a, OfferStatus::Pending, 40, 0xaa_u8, 0x10_u8),
        (offer_b, OfferStatus::Active, 60, 0xbb, 0xaa),
        (offer_c, OfferStatus::Pending, 80, 0xcc, 0xdd),
        (offer_d, OfferStatus::Pending, 70, 0xaa, 0xee),
    ] {
        let mut offer = offer_model(id, height, unique_32_bytes_from_uuid(id));
        offer.current_status = status;
        offer.collateral_asset_id = vec![collat; 32];
        offer.principal_asset_id = vec![princ; 32];
        seed_offer_row(&pool, &offer).await?;
    }

    let (base_url, server_handle) = start_api(pool).await?;
    let http = reqwest::Client::new();

    // status=pending -> 3 offers, ordered by height DESC: c(80) -> d(70) -> a(40).
    let pending = get_json(&http, format!("{base_url}/offers?status=pending")).await?;
    assert_eq!(pending.as_array().map_or(0, Vec::len), 3);
    assert_eq!(pending[0]["id"], offer_c.to_string());
    assert_eq!(pending[1]["id"], offer_d.to_string());
    assert_eq!(pending[2]["id"], offer_a.to_string());

    // `asset` matches either collateral_asset_id or principal_asset_id:
    // a(collat=aa), b(princ=aa), d(collat=aa).
    let asset_filter = "aa".repeat(32);
    let by_asset = get_json(&http, format!("{base_url}/offers?asset={asset_filter}")).await?;
    assert_eq!(by_asset.as_array().map_or(0, Vec::len), 3);
    assert_eq!(by_asset[0]["id"], offer_d.to_string());
    assert_eq!(by_asset[1]["id"], offer_b.to_string());
    assert_eq!(by_asset[2]["id"], offer_a.to_string());

    let paged = get_json(&http, format!("{base_url}/offers?limit=1&offset=1")).await?;
    assert_eq!(paged.as_array().map_or(0, Vec::len), 1);
    assert_eq!(paged[0]["id"], offer_d.to_string());

    let full_pending = get_json(
        &http,
        format!("{base_url}/offers/full?status=pending&limit=1"),
    )
    .await?;
    assert_eq!(full_pending.as_array().map_or(0, Vec::len), 1);
    assert_eq!(full_pending[0]["id"], offer_c.to_string());
    assert_eq!(full_pending[0]["status"], "pending");

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn history_endpoints_return_404_for_unknown_offer() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let (base_url, server_handle) = start_api(pool).await?;
    let http = reqwest::Client::new();
    let unknown_offer_id = Uuid::new_v4();

    for path in [
        format!("{base_url}/offers/{unknown_offer_id}/participants"),
        format!("{base_url}/offers/{unknown_offer_id}/participants/history"),
        format!("{base_url}/offers/{unknown_offer_id}/utxos"),
    ] {
        let response = http.get(path).send().await?;
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let body = response_json(response).await?;
        assert_eq!(body["error"]["code"], "not_found");
    }

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn query_endpoints_return_empty_arrays_when_no_matches() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let (base_url, server_handle) = start_api(pool).await?;
    let http = reqwest::Client::new();

    let by_script = get_json(
        &http,
        format!("{base_url}/offers/by-script?script_pubkey=52ac"),
    )
    .await?;
    assert_eq!(by_script.as_array().map_or(0, Vec::len), 0);

    let by_borrower = get_json(
        &http,
        format!("{base_url}/offers/by-borrower-pubkey?borrower_pubkey={FIXED_BORROWER_PUBKEY_HEX}"),
    )
    .await?;
    assert_eq!(by_borrower.as_array().map_or(0, Vec::len), 0);

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn validation_errors_match_error_contract() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let (base_url, server_handle) = start_api(pool).await?;
    let http = reqwest::Client::new();

    let not_found = http
        .get(format!("{base_url}/offers/{}", Uuid::new_v4()))
        .send()
        .await?;
    assert_eq!(not_found.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        response_json(not_found).await?["error"]["code"],
        "not_found"
    );

    let invalid_script = http
        .get(format!("{base_url}/offers/by-script?script_pubkey=zzzz"))
        .send()
        .await?;
    assert_eq!(invalid_script.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(invalid_script).await?["error"]["code"],
        "bad_request"
    );

    let invalid_borrower = http
        .get(format!(
            "{base_url}/offers/by-borrower-pubkey?borrower_pubkey=deadbeef"
        ))
        .send()
        .await?;
    assert_eq!(invalid_borrower.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(invalid_borrower).await?["error"]["code"],
        "bad_request"
    );

    server_handle.abort();
    Ok(())
}

/// Regression: guards the "no sleep" assumption in `start_api`. The server
/// must accept a request immediately after the helper returns.
#[tokio::test]
#[serial]
async fn server_accepts_connection_immediately_after_start_api() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let (base_url, server_handle) = start_api(pool).await?;
    let http = reqwest::Client::new();

    let response = timeout(
        Duration::from_secs(2),
        http.get(format!("{base_url}/offers")).send(),
    )
    .await??;
    assert!(response.status().is_success());

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn offers_endpoint_returns_400_on_invalid_status_enum() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let (base_url, server_handle) = start_api(pool).await?;
    let http = reqwest::Client::new();

    let response = http
        .get(format!("{base_url}/offers?status=bogus"))
        .send()
        .await?;
    assert_eq!(
        response.status(),
        StatusCode::BAD_REQUEST,
        "unknown `status` must be rejected by Query<OfferFilters>; if this \
         fails the endpoint is silently treating it as `None` -> regression"
    );

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn offers_endpoint_returns_400_on_non_uuid_path() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let (base_url, server_handle) = start_api(pool).await?;
    let http = reqwest::Client::new();

    let response = http
        .get(format!("{base_url}/offers/not-a-uuid"))
        .send()
        .await?;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn offers_batch_returns_400_on_malformed_body() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let (base_url, server_handle) = start_api(pool).await?;
    let http = reqwest::Client::new();

    // Pins: Axum's `Json` extractor splits failure modes:
    //   syntactically invalid JSON    -> 400
    //   missing/wrong-typed field     -> 422
    // Pin both so a future custom rejection layer doesn't change the contract
    // silently.
    let garbage = http
        .post(format!("{base_url}/offers/batch"))
        .header("content-type", "application/json")
        .body("{ not json }")
        .send()
        .await?;
    assert_eq!(garbage.status(), StatusCode::BAD_REQUEST);

    let missing_ids = http
        .post(format!("{base_url}/offers/batch"))
        .header("content-type", "application/json")
        .body("{}")
        .send()
        .await?;
    assert_eq!(missing_ids.status(), StatusCode::UNPROCESSABLE_ENTITY);

    server_handle.abort();
    Ok(())
}

/// Intent: mirrors `OfferDetailsResponse` flattened into one struct, defined
/// locally on purpose. Decouples the test from serde renames on the
/// production DTO.
#[derive(serde::Deserialize, Debug)]
#[allow(dead_code)]
struct ExpectedOfferDetailsDto {
    id: Uuid,
    status: String,
    collateral_asset: String,
    principal_asset: String,
    collateral_amount: u64,
    principal_amount: u64,
    interest_rate: u32,
    loan_expiration_time: u32,
    created_at_height: u64,
    created_at_txid: String,
    borrower_pubkey: String,
    borrower_output_script_hash: String,
    first_parameters_nft_asset: String,
    second_parameters_nft_asset: String,
    borrower_nft_asset: String,
    lender_nft_asset: String,
    participants: Vec<ExpectedParticipantDto>,
}

#[derive(serde::Deserialize, Debug)]
#[allow(dead_code)]
struct ExpectedParticipantDto {
    offer_id: Uuid,
    participant_type: String,
    script_pubkey: String,
    txid: String,
    vout: u32,
    created_at_height: u64,
    spent_txid: Option<String>,
    spent_at_height: Option<u64>,
}

#[tokio::test]
#[serial]
async fn offer_details_full_dto_shape() -> anyhow::Result<()> {
    let (base_url, server_handle, pending_offer, _active) = setup_seeded_api().await?;
    let http = reqwest::Client::new();

    let raw = get_json(&http, format!("{base_url}/offers/{pending_offer}")).await?;
    let dto: ExpectedOfferDetailsDto =
        serde_json::from_value(raw.clone()).expect("response must match full DTO shape");

    assert_eq!(dto.id, pending_offer);
    assert_eq!(dto.status, "pending");
    assert_eq!(dto.collateral_amount, 1_000);
    assert_eq!(dto.principal_amount, 500);
    assert_eq!(dto.interest_rate, 120);
    assert_eq!(dto.loan_expiration_time, 1_234_567);
    assert_eq!(dto.created_at_height, PENDING_OFFER_HEIGHT as u64);
    assert_eq!(dto.borrower_pubkey, FIXED_BORROWER_PUBKEY_HEX);
    // 32-byte seeded values serialize as 64-char hex strings.
    assert_eq!(dto.collateral_asset.len(), 64);
    assert_eq!(dto.principal_asset.len(), 64);
    assert_eq!(dto.first_parameters_nft_asset.len(), 64);
    assert_eq!(dto.second_parameters_nft_asset.len(), 64);
    assert_eq!(dto.borrower_nft_asset.len(), 64);
    assert_eq!(dto.lender_nft_asset.len(), 64);
    assert_eq!(dto.participants.len(), 1);
    assert_eq!(dto.participants[0].script_pubkey, "52ac");
    assert_eq!(dto.participants[0].participant_type, "borrower");
    assert!(dto.participants[0].spent_txid.is_none());

    server_handle.abort();
    Ok(())
}
