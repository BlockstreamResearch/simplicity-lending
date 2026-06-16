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
    factory_model, offer_model, outpoint_from_uuid_vout, seed_factory_row, seed_offer_row,
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

fn ids_from_objects(value: &Value) -> Vec<String> {
    let items = value
        .get("items")
        .and_then(Value::as_array)
        .or_else(|| value.as_array());

    let mut ids: Vec<String> = items
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

fn offer_list_items(value: &Value) -> &Value {
    value
        .get("items")
        .expect("offer list response must include items")
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
    factory_id: Uuid,
    offer_id: Uuid,
    status: OfferStatus,
    created_at_height: i64,
) -> anyhow::Result<()> {
    let mut offer = offer_model(
        offer_id,
        factory_id,
        created_at_height,
        unique_32_bytes_from_uuid(offer_id),
    );
    offer.current_status = status;
    seed_offer_row(pool, &offer).await?;

    let outpoint = outpoint_from_uuid_vout(offer_id, 0);
    let pre_lock = spent_offer_utxo(
        offer_id,
        outpoint,
        UtxoType::PendingOffer,
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
        UtxoType::ActiveOffer,
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

const FACTORY_CREATION_HEIGHT: i64 = 41;
const PENDING_OFFER_HEIGHT: i64 = 42;
const ACTIVE_OFFER_HEIGHT: i64 = 43;

async fn setup_seeded_api() -> anyhow::Result<(String, tokio::task::JoinHandle<()>, Uuid, Uuid)> {
    let pool = test_pool().await?;

    let factory_id = Uuid::new_v4();
    let pending_offer = Uuid::new_v4();
    let active_offer = Uuid::new_v4();

    let factory = factory_model(
        factory_id,
        FACTORY_CREATION_HEIGHT,
        unique_32_bytes_from_uuid(factory_id),
    );
    seed_factory_row(&pool, &factory).await?;

    seed_offer_graph(
        &pool,
        factory_id,
        pending_offer,
        OfferStatus::Pending,
        PENDING_OFFER_HEIGHT,
    )
    .await?;
    seed_offer_graph(
        &pool,
        factory_id,
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
    let items = offer_list_items(&json);

    assert_eq!(json["total"], 2);
    assert_eq!(json["limit"], 50);
    assert_eq!(json["offset"], 0);
    assert_eq!(items.as_array().map_or(0, Vec::len), 2);
    assert_ids_match_unordered(items, &[pending_offer, active_offer]);

    // Pins default `ORDER BY created_at_height DESC` (active_offer's height > pending's).
    assert_eq!(items[0]["id"], active_offer.to_string());
    assert_eq!(items[0]["status"], "active");
    assert_eq!(items[1]["id"], pending_offer.to_string());
    assert_eq!(items[1]["status"], "pending");

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
async fn offers_filters_apply_status_asset_pagination_and_order() -> anyhow::Result<()> {
    let pool = test_pool().await?;

    let offer_a = Uuid::new_v4();
    let offer_b = Uuid::new_v4();
    let offer_c = Uuid::new_v4();
    let offer_d = Uuid::new_v4();

    let factory_id = Uuid::new_v4();

    let factory = factory_model(factory_id, 30, unique_32_bytes_from_uuid(factory_id));
    seed_factory_row(&pool, &factory).await?;

    for (id, status, height, collat, princ, interest_rate) in [
        (offer_a, OfferStatus::Pending, 40, 0xaa_u8, 0x10_u8, 100),
        (offer_b, OfferStatus::Active, 60, 0xbb, 0xaa, 300),
        (offer_c, OfferStatus::Pending, 80, 0xcc, 0xdd, 400),
        (offer_d, OfferStatus::Pending, 70, 0xaa, 0xee, 200),
    ] {
        let mut offer = offer_model(id, factory_id, height, unique_32_bytes_from_uuid(id));
        offer.current_status = status;
        offer.collateral_asset_id = vec![collat; 32];
        offer.principal_asset_id = vec![princ; 32];
        offer.interest_rate = interest_rate;
        seed_offer_row(&pool, &offer).await?;
    }

    let (base_url, server_handle) = start_api(pool.clone()).await?;
    let http = reqwest::Client::new();

    // status=pending -> 3 offers, ordered by height DESC: c(80) -> d(70) -> a(40).
    let pending = get_json(&http, format!("{base_url}/offers?status=pending")).await?;
    let pending_items = offer_list_items(&pending);
    assert_eq!(pending["total"], 3);
    assert_eq!(pending_items.as_array().map_or(0, Vec::len), 3);
    assert_eq!(pending_items[0]["id"], offer_c.to_string());
    assert_eq!(pending_items[1]["id"], offer_d.to_string());
    assert_eq!(pending_items[2]["id"], offer_a.to_string());

    // Multi-status filter: pending + active -> all four except none (b is active).
    let multi_status = get_json(&http, format!("{base_url}/offers?status=pending,active")).await?;
    assert_eq!(multi_status["total"], 4);
    assert_ids_match_unordered(
        offer_list_items(&multi_status),
        &[offer_a, offer_b, offer_c, offer_d],
    );

    // Asset pair filter: a(collat=aa, princ=10) is the only match.
    let collateral_aa = "aa".repeat(32);
    let principal_10 = "10".repeat(32);
    let by_pair = get_json(
        &http,
        format!(
            "{base_url}/offers?collateral_asset={collateral_aa}&principal_asset={principal_10}"
        ),
    )
    .await?;
    let by_pair_items = offer_list_items(&by_pair);
    assert_eq!(by_pair["total"], 1);
    assert_eq!(by_pair_items.as_array().map_or(0, Vec::len), 1);
    assert_eq!(by_pair_items[0]["id"], offer_a.to_string());

    // collateral_asset alone: a and d (collat=aa), ordered by height DESC.
    let by_collateral = get_json(
        &http,
        format!("{base_url}/offers?collateral_asset={collateral_aa}"),
    )
    .await?;
    let by_collateral_items = offer_list_items(&by_collateral);
    assert_eq!(by_collateral["total"], 2);
    assert_eq!(by_collateral_items[0]["id"], offer_d.to_string());
    assert_eq!(by_collateral_items[1]["id"], offer_a.to_string());

    let paged = get_json(&http, format!("{base_url}/offers?limit=1&offset=1")).await?;
    let paged_items = offer_list_items(&paged);
    assert_eq!(paged["total"], 4);
    assert_eq!(paged["limit"], 1);
    assert_eq!(paged["offset"], 1);
    assert_eq!(paged_items.as_array().map_or(0, Vec::len), 1);
    assert_eq!(paged_items[0]["id"], offer_d.to_string());

    let sorted = get_json(
        &http,
        format!("{base_url}/offers?sort_by=interest_rate&sort_dir=asc&limit=4"),
    )
    .await?;
    let sorted_items = offer_list_items(&sorted);
    assert_eq!(sorted_items[0]["id"], offer_a.to_string());
    assert_eq!(sorted_items[1]["id"], offer_d.to_string());
    assert_eq!(sorted_items[2]["id"], offer_b.to_string());
    assert_eq!(sorted_items[3]["id"], offer_c.to_string());

    // Filter using API display hex (format_hex byte order), non-uniform asset id bytes.
    let offer_e = Uuid::new_v4();
    let varied_collateral: Vec<u8> = (1_u8..=32).collect();
    let mut offer_e_model =
        offer_model(offer_e, factory_id, 90, unique_32_bytes_from_uuid(offer_e));
    offer_e_model.collateral_asset_id = varied_collateral.clone();
    offer_e_model.principal_asset_id = vec![0xee; 32];
    seed_offer_row(&pool, &offer_e_model).await?;

    let varied_collateral_hex = lending_indexer::api::utils::format_hex(varied_collateral);
    let by_display_hex = get_json(
        &http,
        format!("{base_url}/offers?collateral_asset={varied_collateral_hex}"),
    )
    .await?;
    assert_eq!(by_display_hex["total"], 1);
    assert_eq!(
        offer_list_items(&by_display_hex)[0]["id"],
        offer_e.to_string()
    );

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
        "unknown `status` must be rejected by Query<OfferListQuery>; if this \
         fails the endpoint is silently ignoring the filter -> regression"
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

/// Intent: mirrors `OfferDetailsResponse` flattened into one struct, defined
/// locally on purpose. Decouples the test from serde renames on the
/// production DTO.
#[derive(serde::Deserialize, Debug)]
#[allow(dead_code)]
struct ExpectedOfferDetailsDto {
    id: Uuid,
    issuance_factory_id: Uuid,
    status: String,
    collateral_asset: String,
    principal_asset: String,
    collateral_amount: u64,
    principal_amount: u64,
    interest_rate: u32,
    loan_expiration_height: u32,
    created_at_height: u64,
    created_at_txid: String,
    borrower_nft_asset: String,
    lender_nft_asset: String,
    protocol_fee_keeper_asset: String,
    utxos: Vec<ExpectedOfferUtxoDto>,
    participants: Vec<ExpectedParticipantDto>,
}

#[derive(serde::Deserialize, Debug)]
#[allow(dead_code)]
struct ExpectedOfferUtxoDto {
    offer_id: Uuid,
    utxo_type: String,
    spent_txid: Option<String>,
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
    assert_eq!(dto.loan_expiration_height, 1_234_567);
    assert_eq!(dto.created_at_height, PENDING_OFFER_HEIGHT as u64);
    // 32-byte seeded values serialize as 64-char hex strings.
    assert_eq!(dto.collateral_asset.len(), 64);
    assert_eq!(dto.principal_asset.len(), 64);
    assert_eq!(dto.borrower_nft_asset.len(), 64);
    assert_eq!(dto.lender_nft_asset.len(), 64);
    assert_eq!(dto.protocol_fee_keeper_asset.len(), 64);
    assert_eq!(dto.utxos.len(), 1);
    assert_eq!(dto.utxos[0].utxo_type, "active_offer");
    assert!(dto.utxos[0].spent_txid.is_none());
    assert_eq!(dto.participants.len(), 1);
    assert_eq!(dto.participants[0].script_pubkey, "52ac");
    assert_eq!(dto.participants[0].participant_type, "borrower");
    assert!(dto.participants[0].spent_txid.is_none());

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn borrower_dashboard_returns_overview_and_filtered_offers() -> anyhow::Result<()> {
    let (base_url, server_handle, pending_offer, active_offer) = setup_seeded_api().await?;
    let http = reqwest::Client::new();

    let dashboard = get_json(
        &http,
        format!("{base_url}/borrowers/by-script?script_pubkey=52ac"),
    )
    .await?;

    let overview = &dashboard["overview"];
    assert_eq!(overview["active_loans"], 1);
    assert_eq!(overview["pending_offers"], 1);
    assert_eq!(
        overview["collateral_locked"].as_array().map_or(0, Vec::len),
        1
    );
    assert_eq!(overview["collateral_locked"][0]["amount"], 2_000);
    assert_eq!(overview["borrowings"].as_array().map_or(0, Vec::len), 1);
    assert_eq!(overview["borrowings"][0]["amount"], 1_000);

    let offers = &dashboard["offers"];
    assert_eq!(offers["total"], 2);
    assert_eq!(offers["limit"], 50);
    assert_eq!(offers["offset"], 0);
    assert_ids_match_unordered(&offers["items"], &[pending_offer, active_offer]);
    assert!(
        offers["items"]
            .as_array()
            .into_iter()
            .flatten()
            .all(|item| {
                item.get("participants").is_none()
                    && item["collateral_amount"].as_u64() == Some(1_000)
                    && item["principal_amount"].as_u64() == Some(500)
            })
    );

    let pending_only = get_json(
        &http,
        format!("{base_url}/borrowers/by-script?script_pubkey=52ac&status=pending"),
    )
    .await?;
    assert_eq!(pending_only["offers"]["total"], 1);
    assert_eq!(
        pending_only["offers"]["items"][0]["id"],
        pending_offer.to_string()
    );
    assert_eq!(pending_only["overview"]["pending_offers"], 1);
    assert_eq!(pending_only["overview"]["active_loans"], 1);

    let unknown_wallet = get_json(
        &http,
        format!("{base_url}/borrowers/by-script?script_pubkey=dead"),
    )
    .await?;
    assert_eq!(unknown_wallet["overview"]["active_loans"], 0);
    assert_eq!(unknown_wallet["overview"]["pending_offers"], 0);
    assert_eq!(
        unknown_wallet["overview"]["collateral_locked"]
            .as_array()
            .map_or(0, Vec::len),
        0
    );
    assert_eq!(unknown_wallet["offers"]["total"], 0);

    server_handle.abort();
    Ok(())
}
