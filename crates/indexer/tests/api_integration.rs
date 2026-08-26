mod common;

use std::time::Duration;

use lending_indexer::api::server::run_server;
use lending_indexer::events::{INDEXER_EVENTS_CHANNEL, IndexerEvent};
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
    factory_model, offer_model, outpoint_from_offer_id, seed_factory_row, seed_offer_row,
    seed_offer_utxo_row, seed_participant_utxo_row, seed_sync_state, spent_offer_utxo,
    spent_participant, test_pool, unique_32_bytes_from_uuid, unspent_offer_utxo,
    unspent_participant, vault_tracking,
};

fn participant_script<'a>(item: &'a Value, role: &str) -> Option<&'a str> {
    item["participants"]
        .as_array()?
        .iter()
        .find(|participant| participant["participant_type"].as_str() == Some(role))?
        .get("script_pubkey")?
        .as_str()
}

fn offer_id_from_json(value: &Value) -> Option<i64> {
    value.get("id")?.as_str()?.parse().ok()
}

fn find_list_item(items: &Value, offer_id: i64) -> Option<&Value> {
    items
        .as_array()?
        .iter()
        .find(|item| offer_id_from_json(item) == Some(offer_id))
}

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
                .filter_map(offer_id_from_json)
                .map(|id| id.to_string())
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

fn offer_ids_from_array(value: &Value) -> Vec<String> {
    let mut ids: Vec<String> = value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_str().map(ToOwned::to_owned))
                .collect()
        })
        .unwrap_or_default();
    ids.sort();
    ids
}

fn assert_ids_match_unordered(value: &Value, expected: &[i64]) {
    let mut expected_ids: Vec<String> = expected.iter().map(|id| id.to_string()).collect();
    expected_ids.sort();
    assert_eq!(ids_from_objects(value), expected_ids);
}

fn assert_offer_ids_match_unordered(value: &Value, expected: &[i64]) {
    let mut expected_ids: Vec<String> = expected.iter().map(|id| id.to_string()).collect();
    expected_ids.sort();
    assert_eq!(offer_ids_from_array(value), expected_ids);
}

#[tokio::test]
#[serial]
async fn health_endpoints_report_liveness_and_readiness() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let (base_url, _server) = start_api(pool).await?;
    let http = reqwest::Client::new();

    let health = http.get(format!("{base_url}/health")).send().await?;
    assert_eq!(health.status(), StatusCode::OK);
    let health_json = response_json(health).await?;
    assert_eq!(health_json["status"], "ok");

    let ready = http.get(format!("{base_url}/ready")).send().await?;
    assert_eq!(ready.status(), StatusCode::OK);
    let ready_json = response_json(ready).await?;
    assert_eq!(ready_json["status"], "ok");

    Ok(())
}

async fn seed_offer_graph(
    pool: &PgPool,
    factory_id: Uuid,
    txid_seed: i64,
    status: OfferStatus,
    created_at_height: i64,
) -> anyhow::Result<i64> {
    let mut offer = offer_model(txid_seed, factory_id, created_at_height);
    offer.current_status = status;
    let offer_id = seed_offer_row(pool, &mut offer).await?;

    let outpoint = outpoint_from_offer_id(txid_seed, 0);
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

    if status == OfferStatus::Active {
        let borrower_principal = unspent_offer_utxo(
            offer_id,
            OutPoint {
                txid: outpoint.txid,
                vout: 1,
            },
            UtxoType::BorrowerPrincipal,
            created_at_height + 2,
        );
        seed_offer_utxo_row(pool, &borrower_principal).await?;
    }

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

    let current_lender_script = match status {
        OfferStatus::Pending => vec![0x50, 0xac],
        _ => vec![0x53, 0xac],
    };
    let old_lender = spent_participant(
        offer_id,
        ParticipantType::Lender,
        OutPoint {
            txid: outpoint.txid,
            vout: 2,
        },
        vec![0x51, 0xad],
        created_at_height,
        created_at_height + 3,
        0x88,
    );
    let current_lender = unspent_participant(
        offer_id,
        ParticipantType::Lender,
        OutPoint {
            txid: outpoint.txid,
            vout: 4,
        },
        current_lender_script,
        created_at_height + 4,
    );
    seed_participant_utxo_row(pool, &old_lender).await?;
    seed_participant_utxo_row(pool, &current_lender).await?;

    Ok(offer_id)
}

const FACTORY_CREATION_HEIGHT: i64 = 41;
const PENDING_OFFER_HEIGHT: i64 = 42;
const ACTIVE_OFFER_HEIGHT: i64 = 43;

async fn setup_seeded_api() -> anyhow::Result<(String, tokio::task::JoinHandle<()>, i64, i64)> {
    let pool = test_pool().await?;

    let factory_id = Uuid::new_v4();

    let factory = factory_model(
        factory_id,
        FACTORY_CREATION_HEIGHT,
        unique_32_bytes_from_uuid(factory_id),
    );
    seed_factory_row(&pool, &factory).await?;

    let pending_offer = seed_offer_graph(
        &pool,
        factory_id,
        1,
        OfferStatus::Pending,
        PENDING_OFFER_HEIGHT,
    )
    .await?;
    let active_offer = seed_offer_graph(
        &pool,
        factory_id,
        2,
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

    // Pins default `ORDER BY updated_at_height DESC` (active is updated after insertion).
    assert_eq!(items[0]["id"], active_offer.to_string());
    assert_eq!(items[0]["status"], "active");
    assert_eq!(items[1]["id"], pending_offer.to_string());
    assert_eq!(items[1]["status"], "pending");

    let active_item = find_list_item(items, active_offer).expect("active offer in list");
    assert_eq!(participant_script(active_item, "borrower"), Some("52ac"));
    assert_eq!(participant_script(active_item, "lender"), Some("53ac"));
    assert_eq!(active_item["borrower_principal_utxo"]["vout"], 1);

    let pending_item = find_list_item(items, pending_offer).expect("pending offer in list");
    assert_eq!(participant_script(pending_item, "borrower"), Some("52ac"));
    assert_eq!(participant_script(pending_item, "lender"), Some("50ac"));
    assert!(pending_item.get("borrower_principal_utxo").is_none());

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn offers_expose_and_sort_by_updated_at_height() -> anyhow::Result<()> {
    let pool = test_pool().await?;

    let factory_id = Uuid::new_v4();
    seed_factory_row(
        &pool,
        &factory_model(factory_id, 1, unique_32_bytes_from_uuid(factory_id)),
    )
    .await?;

    let mut pending = offer_model(1, factory_id, 100);
    let pending_id = seed_offer_row(&pool, &mut pending).await?;

    let mut active = offer_model(2, factory_id, 50);
    active.current_status = OfferStatus::Active;
    active.updated_at_height = 200;
    let active_id = seed_offer_row(&pool, &mut active).await?;

    let (base_url, server_handle) = start_api(pool).await?;
    let http = reqwest::Client::new();

    let list = get_json(&http, format!("{base_url}/offers")).await?;
    let items = offer_list_items(&list);

    let pending_item = find_list_item(items, pending_id).expect("pending offer");
    let active_item = find_list_item(items, active_id).expect("active offer");

    assert_eq!(pending_item["updated_at_height"], 100);
    assert_eq!(pending_item["created_at_height"], 100);
    assert_eq!(active_item["updated_at_height"], 200);
    assert_eq!(active_item["created_at_height"], 50);

    assert_eq!(items[0]["id"], active_id.to_string());
    assert_eq!(items[1]["id"], pending_id.to_string());

    let by_updated = get_json(
        &http,
        format!("{base_url}/offers?sort_by=updated_at_height"),
    )
    .await?;
    assert_eq!(
        offer_list_items(&by_updated)[0]["id"],
        active_id.to_string()
    );

    let by_created = get_json(
        &http,
        format!("{base_url}/offers?sort_by=created_at_height"),
    )
    .await?;
    assert_eq!(
        offer_list_items(&by_created)[0]["id"],
        pending_id.to_string()
    );

    server_handle.abort();
    Ok(())
}

async fn seed_pending_offer_with_expiration(
    pool: &PgPool,
    factory_id: Uuid,
    txid_seed: i64,
    created_at_height: i64,
    loan_expiration_time: i32,
) -> anyhow::Result<i64> {
    let mut offer = offer_model(txid_seed, factory_id, created_at_height);
    offer.loan_expiration_time = loan_expiration_time;

    seed_offer_row(pool, &mut offer).await
}

#[tokio::test]
#[serial]
async fn offers_not_expired_filters_by_sync_state_height() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    seed_sync_state(&pool, 1_000).await?;

    let factory_id = Uuid::new_v4();
    seed_factory_row(
        &pool,
        &factory_model(factory_id, 1, unique_32_bytes_from_uuid(factory_id)),
    )
    .await?;

    let expired_offer = seed_pending_offer_with_expiration(&pool, factory_id, 10, 100, 999).await?;
    let at_expiration_offer =
        seed_pending_offer_with_expiration(&pool, factory_id, 20, 100, 1_000).await?;
    let future_offer =
        seed_pending_offer_with_expiration(&pool, factory_id, 30, 100, 1_001).await?;

    let (base_url, server_handle) = start_api(pool).await?;
    let http = reqwest::Client::new();

    let all = get_json(&http, format!("{base_url}/offers?status=pending")).await?;
    assert_eq!(all["total"], 3);
    assert_ids_match_unordered(
        offer_list_items(&all),
        &[expired_offer, at_expiration_offer, future_offer],
    );

    let not_expired = get_json(
        &http,
        format!("{base_url}/offers?status=pending&not_expired=true"),
    )
    .await?;
    assert_eq!(not_expired["total"], 2);
    assert_ids_match_unordered(
        offer_list_items(&not_expired),
        &[at_expiration_offer, future_offer],
    );

    let invalid = http
        .get(format!(
            "{base_url}/offers?status=pending&not_expired=maybe"
        ))
        .send()
        .await?;
    assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);

    server_handle.abort();
    Ok(())
}

async fn seed_pending_offer_with_participant_script(
    pool: &PgPool,
    factory_id: Uuid,
    txid_seed: i64,
    created_at_height: i64,
    participant_type: ParticipantType,
    script_pubkey: Vec<u8>,
) -> anyhow::Result<i64> {
    let mut offer = offer_model(txid_seed, factory_id, created_at_height);
    let offer_id = seed_offer_row(pool, &mut offer).await?;

    let outpoint = outpoint_from_offer_id(txid_seed, 0);
    seed_participant_utxo_row(
        pool,
        &unspent_participant(
            offer_id,
            participant_type,
            outpoint,
            script_pubkey,
            created_at_height,
        ),
    )
    .await?;

    Ok(offer_id)
}

#[tokio::test]
#[serial]
async fn offers_exclude_participant_script_filters_own_pending_offers() -> anyhow::Result<()> {
    let pool = test_pool().await?;

    let factory_id = Uuid::new_v4();
    seed_factory_row(
        &pool,
        &factory_model(factory_id, 1, unique_32_bytes_from_uuid(factory_id)),
    )
    .await?;

    let offer_a = seed_pending_offer_with_participant_script(
        &pool,
        factory_id,
        10,
        100,
        ParticipantType::Borrower,
        vec![0x52, 0xac],
    )
    .await?;
    let offer_b = seed_pending_offer_with_participant_script(
        &pool,
        factory_id,
        20,
        200,
        ParticipantType::Borrower,
        vec![0x53, 0xac],
    )
    .await?;

    let (base_url, server_handle) = start_api(pool).await?;
    let http = reqwest::Client::new();

    let all = get_json(&http, format!("{base_url}/offers?status=pending")).await?;
    assert_eq!(all["total"], 2);
    assert_ids_match_unordered(offer_list_items(&all), &[offer_a, offer_b]);

    let exclude_a = get_json(
        &http,
        format!("{base_url}/offers?status=pending&exclude_participant_script=52ac"),
    )
    .await?;
    assert_eq!(exclude_a["total"], 1);
    assert_eq!(offer_list_items(&exclude_a)[0]["id"], offer_b.to_string());

    let exclude_b = get_json(
        &http,
        format!("{base_url}/offers?status=pending&exclude_participant_script=53ac"),
    )
    .await?;
    assert_eq!(exclude_b["total"], 1);
    assert_eq!(offer_list_items(&exclude_b)[0]["id"], offer_a.to_string());

    let invalid = http
        .get(format!(
            "{base_url}/offers?status=pending&exclude_participant_script=zzzz"
        ))
        .send()
        .await?;
    assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn offers_exclude_participant_script_honors_role() -> anyhow::Result<()> {
    let pool = test_pool().await?;

    let factory_id = Uuid::new_v4();
    seed_factory_row(
        &pool,
        &factory_model(factory_id, 1, unique_32_bytes_from_uuid(factory_id)),
    )
    .await?;

    let offer_a = seed_pending_offer_with_participant_script(
        &pool,
        factory_id,
        10,
        100,
        ParticipantType::Borrower,
        vec![0x52, 0xac],
    )
    .await?;
    let offer_b = seed_pending_offer_with_participant_script(
        &pool,
        factory_id,
        20,
        200,
        ParticipantType::Lender,
        vec![0x52, 0xac],
    )
    .await?;

    let (base_url, server_handle) = start_api(pool).await?;
    let http = reqwest::Client::new();

    let exclude_borrower = get_json(
        &http,
        format!(
            "{base_url}/offers?status=pending&exclude_participant_script=52ac&exclude_participant_role=borrower"
        ),
    )
    .await?;
    assert_eq!(exclude_borrower["total"], 1);
    assert_eq!(
        offer_list_items(&exclude_borrower)[0]["id"],
        offer_b.to_string()
    );

    let exclude_lender = get_json(
        &http,
        format!(
            "{base_url}/offers?status=pending&exclude_participant_script=52ac&exclude_participant_role=lender"
        ),
    )
    .await?;
    assert_eq!(exclude_lender["total"], 1);
    assert_eq!(
        offer_list_items(&exclude_lender)[0]["id"],
        offer_a.to_string()
    );

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn get_offers_overview_returns_active_totals_only() -> anyhow::Result<()> {
    let (base_url, server_handle, _pending_offer, _active_offer) = setup_seeded_api().await?;
    let http = reqwest::Client::new();

    let overview = get_json(&http, format!("{base_url}/offers/overview")).await?;

    assert_eq!(overview["active_loans_count"], 1);
    assert_eq!(
        overview["collateral_locked"].as_array().map_or(0, Vec::len),
        1
    );
    assert_eq!(overview["collateral_locked"][0]["amount"], "2000");
    assert_eq!(
        overview["active_loan_principal"]
            .as_array()
            .map_or(0, Vec::len),
        1
    );
    assert_eq!(overview["active_loan_principal"][0]["amount"], "506");

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
    assert_offer_ids_match_unordered(&current, &[pending_offer, active_offer]);

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

    let factory_id = Uuid::new_v4();

    let factory = factory_model(factory_id, 30, unique_32_bytes_from_uuid(factory_id));
    seed_factory_row(&pool, &factory).await?;

    let mut offer_a = 0_i64;
    let mut offer_b = 0_i64;
    let mut offer_c = 0_i64;
    let mut offer_d = 0_i64;

    for (txid_seed, status, height, collat, princ, interest_rate, offer_id_out) in [
        (
            10_i64,
            OfferStatus::Pending,
            40,
            0xaa_u8,
            0x10_u8,
            100,
            &mut offer_a,
        ),
        (
            20_i64,
            OfferStatus::Active,
            60,
            0xbb,
            0xaa,
            300,
            &mut offer_b,
        ),
        (
            30_i64,
            OfferStatus::Pending,
            80,
            0xcc,
            0xdd,
            400,
            &mut offer_c,
        ),
        (
            40_i64,
            OfferStatus::Pending,
            70,
            0xaa,
            0xee,
            200,
            &mut offer_d,
        ),
    ] {
        let mut offer = offer_model(txid_seed, factory_id, height);
        offer.current_status = status;
        offer.collateral_asset_id = vec![collat; 32];
        offer.principal_asset_id = vec![princ; 32];
        offer.interest_rate = interest_rate;
        *offer_id_out = seed_offer_row(&pool, &mut offer).await?;
    }

    let (base_url, server_handle) = start_api(pool.clone()).await?;
    let http = reqwest::Client::new();

    // status=pending -> 3 offers, ordered by updated_at_height DESC: c(80) -> d(70) -> a(40).
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

    // collateral_asset alone: a and d (collat=aa), ordered by updated_at_height DESC.
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
    let varied_collateral: Vec<u8> = (1_u8..=32).collect();
    let mut offer_e_model = offer_model(50, factory_id, 90);
    offer_e_model.collateral_asset_id = varied_collateral.clone();
    offer_e_model.principal_asset_id = vec![0xee; 32];
    let offer_e = seed_offer_row(&pool, &mut offer_e_model).await?;

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

    let not_found = http.get(format!("{base_url}/offers/999999")).send().await?;
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
async fn events_sse_receives_block_indexed_after_notify() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let notify_pool = pool.clone();
    let (base_url, server_handle) = start_api(pool).await?;
    let http = reqwest::Client::new();

    // Give the LISTEN task a moment to attach before NOTIFY.
    tokio::time::sleep(Duration::from_millis(200)).await;

    let response_fut = http.get(format!("{base_url}/events")).send();
    let mut response = timeout(Duration::from_secs(5), response_fut).await??;
    assert_eq!(response.status(), StatusCode::OK);
    assert!(
        response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.starts_with("text/event-stream")),
        "expected text/event-stream content type"
    );

    let payload = serde_json::to_string(&IndexerEvent::BlockIndexed { height: 2_500_001 })?;
    sqlx::query("SELECT pg_notify($1, $2)")
        .bind(INDEXER_EVENTS_CHANNEL)
        .bind(payload)
        .execute(&notify_pool)
        .await?;

    let body = timeout(Duration::from_secs(5), async {
        let mut buffer = String::new();
        while let Some(chunk) = response.chunk().await? {
            buffer.push_str(&String::from_utf8_lossy(&chunk));
            if buffer.contains("block_indexed") && buffer.contains("2500001") {
                return Ok::<_, anyhow::Error>(buffer);
            }
        }
        anyhow::bail!("SSE stream ended before block_indexed event; buffer={buffer}");
    })
    .await??;

    assert!(body.contains("event: block_indexed"));
    assert!(body.contains(r#""type":"block_indexed""#));
    assert!(body.contains(r#""height":2500001"#));

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
async fn offers_endpoint_returns_400_on_invalid_path_id() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let (base_url, server_handle) = start_api(pool).await?;
    let http = reqwest::Client::new();

    let response = http
        .get(format!("{base_url}/offers/not-an-id"))
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
    id: String,
    issuance_factory_id: Uuid,
    status: String,
    collateral_asset: String,
    principal_asset: String,
    collateral_amount: String,
    principal_amount: String,
    current_debt: String,
    collateral_remaining: String,
    interest_rate: u32,
    loan_expiration_height: u32,
    updated_at_height: u64,
    created_at_height: u64,
    created_at_txid: String,
    borrower_nft_asset: String,
    lender_nft_asset: String,
    protocol_fee_keeper_asset: String,
    borrower_principal_utxo: Option<ExpectedOfferUtxoOutpointShort>,
    utxos: Vec<ExpectedOfferUtxoDto>,
    vaults: Vec<ExpectedOfferVaultDto>,
    participants: Vec<ExpectedParticipantDto>,
    repayments: Vec<ExpectedOfferRepaymentDto>,
    withdrawals: Vec<ExpectedOfferVaultWithdrawalDto>,
}

#[derive(serde::Deserialize, Debug)]
#[allow(dead_code)]
struct ExpectedOfferVaultDto {
    offer_id: String,
    vault_type: String,
    txid: String,
    vout: u32,
    amount: String,
    already_supplied: String,
    is_finalized: bool,
}

#[derive(serde::Deserialize, Debug)]
#[allow(dead_code)]
struct ExpectedOfferVaultWithdrawalDto {
    txid: String,
    height: u64,
    vault_type: String,
    is_full: bool,
    amount_withdrawn: String,
    vault_amount_before: String,
    vault_amount_after: String,
}

#[derive(serde::Deserialize, Debug)]
#[allow(dead_code)]
struct ExpectedOfferRepaymentDto {
    txid: String,
    height: u64,
    amount_repaid: String,
    collateral_unlocked: String,
    debt_before: String,
    debt_after: String,
    collateral_before: String,
    collateral_after: String,
    is_full: bool,
    phase: String,
}

#[derive(serde::Deserialize, Debug)]
#[allow(dead_code)]
struct ExpectedOfferUtxoOutpointShort {
    txid: String,
    vout: u32,
}

#[derive(serde::Deserialize, Debug)]
#[allow(dead_code)]
struct ExpectedOfferUtxoDto {
    offer_id: String,
    utxo_type: String,
    spent_txid: Option<String>,
}

#[derive(serde::Deserialize, Debug)]
#[allow(dead_code)]
struct ExpectedParticipantDto {
    offer_id: String,
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
async fn openapi_json_endpoint_returns_spec() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let (base_url, server_handle) = start_api(pool).await?;
    let http = reqwest::Client::new();

    let response = http
        .get(format!("{base_url}/api-docs/openapi.json"))
        .send()
        .await?
        .error_for_status()?;
    let json = response_json(response).await?;

    assert_eq!(json["info"]["title"], "Simplicity Lending Indexer");
    assert_eq!(json["info"]["version"], env!("CARGO_PKG_VERSION"));
    assert!(json["paths"]["/offers"].is_object());

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn offer_details_full_dto_shape() -> anyhow::Result<()> {
    let (base_url, server_handle, pending_offer, _active) = setup_seeded_api().await?;
    let http = reqwest::Client::new();

    let raw = get_json(&http, format!("{base_url}/offers/{pending_offer}")).await?;
    let dto: ExpectedOfferDetailsDto =
        serde_json::from_value(raw.clone()).expect("response must match full DTO shape");

    assert_eq!(dto.id, pending_offer.to_string());
    assert_eq!(dto.status, "pending");
    assert_eq!(dto.collateral_amount, "1000");
    assert_eq!(dto.principal_amount, "500");
    assert_eq!(dto.current_debt, "506");
    assert_eq!(dto.collateral_remaining, "1000");
    assert_eq!(dto.interest_rate, 120);
    assert_eq!(dto.loan_expiration_height, 1_234_567);
    assert_eq!(dto.updated_at_height, PENDING_OFFER_HEIGHT as u64);
    assert_eq!(dto.created_at_height, PENDING_OFFER_HEIGHT as u64);
    // 32-byte seeded values serialize as 64-char hex strings.
    assert_eq!(dto.collateral_asset.len(), 64);
    assert_eq!(dto.principal_asset.len(), 64);
    assert_eq!(dto.borrower_nft_asset.len(), 64);
    assert_eq!(dto.lender_nft_asset.len(), 64);
    assert_eq!(dto.protocol_fee_keeper_asset.len(), 64);
    assert_eq!(dto.utxos.len(), 2);
    assert_eq!(dto.utxos[0].utxo_type, "pending_offer");
    assert_eq!(dto.utxos[1].utxo_type, "active_offer");
    assert!(dto.utxos[1].spent_txid.is_none());
    assert!(dto.borrower_principal_utxo.is_none());
    assert!(dto.vaults.is_empty());
    assert!(dto.repayments.is_empty());
    assert_eq!(dto.participants.len(), 2);
    assert!(
        dto.participants
            .iter()
            .any(|p| p.participant_type == "borrower" && p.script_pubkey == "52ac")
    );
    assert!(
        dto.participants
            .iter()
            .any(|p| p.participant_type == "lender" && p.script_pubkey == "50ac")
    );

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn active_offer_details_includes_borrower_principal_utxo() -> anyhow::Result<()> {
    let (base_url, server_handle, _pending, active_offer) = setup_seeded_api().await?;
    let http = reqwest::Client::new();

    let raw = get_json(&http, format!("{base_url}/offers/{active_offer}")).await?;
    let dto: ExpectedOfferDetailsDto =
        serde_json::from_value(raw).expect("response must match full DTO shape");

    assert_eq!(dto.id, active_offer.to_string());
    assert_eq!(dto.status, "active");
    assert_eq!(dto.utxos.len(), 3);

    let utxo_types: Vec<&str> = dto.utxos.iter().map(|u| u.utxo_type.as_str()).collect();
    assert!(utxo_types.contains(&"active_offer"));
    assert!(utxo_types.contains(&"borrower_principal"));
    assert!(dto.vaults.is_empty());

    let principal = dto
        .borrower_principal_utxo
        .expect("active offer should include borrower_principal_utxo");
    assert_eq!(principal.vout, 1);

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn repaid_offer_details_includes_active_vaults() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let factory_id = vault_tracking::seed_minimal_factory(&pool).await?;
    let mut offer = vault_tracking::repaid_offer_model(10, factory_id, 500);
    let offer_id = seed_offer_row(&pool, &mut offer).await?;

    let repay_txid = vec![0xab; 32];
    let params = vault_tracking::offer_lending_params(&offer)?;
    let total = params.offer_parameters.get_total_amount_to_repay();
    let protocol_fee = params.offer_parameters.get_total_protocol_fee();
    let lender_amount = total - protocol_fee;

    vault_tracking::seed_offer_vault_row(
        &pool,
        &lending_indexer::models::OfferVaultModel {
            id: 0,
            offer_id,
            vault_type: lending_indexer::models::VaultType::Lender,
            txid: repay_txid.clone(),
            vout: 1,
            amount: lender_amount as i64,
            already_supplied: params.get_lender_vault_parameters().supply_goal as i64,
            is_finalized: true,
            created_at_height: 501,
            updated_at_height: 501,
            spent_txid: None,
            spent_at_height: None,
        },
    )
    .await?;
    vault_tracking::seed_offer_vault_row(
        &pool,
        &lending_indexer::models::OfferVaultModel {
            id: 0,
            offer_id,
            vault_type: lending_indexer::models::VaultType::ProtocolFee,
            txid: repay_txid,
            vout: 2,
            amount: protocol_fee as i64,
            already_supplied: params.get_protocol_fee_vault_parameters().supply_goal as i64,
            is_finalized: true,
            created_at_height: 501,
            updated_at_height: 501,
            spent_txid: None,
            spent_at_height: None,
        },
    )
    .await?;

    let (base_url, server_handle) = start_api(pool).await?;
    let http = reqwest::Client::new();

    let raw = get_json(&http, format!("{base_url}/offers/{offer_id}")).await?;
    let dto: ExpectedOfferDetailsDto =
        serde_json::from_value(raw).expect("response must match full DTO shape");

    assert_eq!(dto.status, "repaid");
    assert_eq!(dto.vaults.len(), 2);
    assert!(
        dto.vaults
            .iter()
            .any(|vault| vault.vault_type == "lender" && vault.is_finalized && vault.vout == 1)
    );
    assert!(
        dto.vaults
            .iter()
            .any(|vault| vault.vault_type == "protocol_fee"
                && vault.is_finalized
                && vault.vout == 2)
    );
    assert_eq!(dto.vaults[0].amount, lender_amount.to_string());

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn active_offer_details_after_partial_includes_vaults_and_repayment() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let factory_id = vault_tracking::seed_minimal_factory(&pool).await?;
    let (offer_id, active_outpoint, offer) =
        vault_tracking::seed_trackable_active_offer(&pool, factory_id, 11, 100).await?;

    let (tx, debt_after) = vault_tracking::build_first_partial_repayment_tx(
        active_outpoint,
        &offer,
        vault_tracking::FIRST_PARTIAL_AMOUNT,
    )?;
    let mut registry = vault_tracking::load_registry(&pool).await?;
    vault_tracking::process_tx_through_registry(
        &pool,
        &mut registry,
        &tx,
        vault_tracking::TRACKABLE_REPAYMENT_HEIGHT,
    )
    .await?;

    vault_tracking::seed_offer_vault_row(
        &pool,
        &lending_indexer::models::OfferVaultModel {
            id: 0,
            offer_id,
            vault_type: lending_indexer::models::VaultType::Lender,
            txid: vec![0xcd; 32],
            vout: 9,
            amount: 1,
            already_supplied: 1,
            is_finalized: false,
            created_at_height: 1,
            updated_at_height: 1,
            spent_txid: Some(vec![0xee; 32]),
            spent_at_height: Some(2),
        },
    )
    .await?;

    let (base_url, server_handle) = start_api(pool).await?;
    let http = reqwest::Client::new();

    let raw = get_json(&http, format!("{base_url}/offers/{offer_id}")).await?;
    let dto: ExpectedOfferDetailsDto =
        serde_json::from_value(raw).expect("response must match full DTO shape");

    assert_eq!(dto.status, "active");
    assert_eq!(dto.current_debt, debt_after.to_string());
    assert_eq!(dto.vaults.len(), 2);
    assert!(dto.vaults.iter().all(|vault| vault.vout != 9));
    assert!(
        dto.utxos
            .iter()
            .any(|utxo| utxo.utxo_type == "active_offer" && utxo.spent_txid.is_some())
    );
    assert!(
        dto.utxos
            .iter()
            .any(|utxo| utxo.utxo_type == "active_offer" && utxo.spent_txid.is_none())
    );
    assert_eq!(dto.repayments.len(), 1);
    assert!(!dto.repayments[0].is_full);
    assert_eq!(dto.repayments[0].phase, "no_repayments");
    assert_eq!(
        dto.repayments[0].amount_repaid,
        vault_tracking::FIRST_PARTIAL_AMOUNT.to_string()
    );
    assert!(dto.withdrawals.is_empty());

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn offer_details_after_lender_claim_includes_withdrawal() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let factory_id = vault_tracking::seed_minimal_factory(&pool).await?;
    let (offer_id, active_outpoint, offer) =
        vault_tracking::seed_trackable_active_offer(&pool, factory_id, 12, 100).await?;

    let repay_tx = vault_tracking::build_full_repayment_tx(active_outpoint, &offer)?;
    let repay_txid = repay_tx.txid();
    let mut registry = vault_tracking::load_registry(&pool).await?;
    vault_tracking::process_tx_through_registry(
        &pool,
        &mut registry,
        &repay_tx,
        vault_tracking::TRACKABLE_REPAYMENT_HEIGHT,
    )
    .await?;

    let params = vault_tracking::offer_lending_params(&offer)?;
    let total = params.offer_parameters.get_total_amount_to_repay();
    let protocol_fee = params.offer_parameters.get_total_protocol_fee();
    let lender_amount = total - protocol_fee;

    let claim_tx = vault_tracking::build_lender_vault_withdraw_all_tx(
        OutPoint {
            txid: repay_txid,
            vout: 1,
        },
        &offer,
        lender_amount,
    )?;
    vault_tracking::process_tx_through_registry(
        &pool,
        &mut registry,
        &claim_tx,
        vault_tracking::TRACKABLE_REPAYMENT_HEIGHT + 1,
    )
    .await?;

    let (base_url, server_handle) = start_api(pool).await?;
    let http = reqwest::Client::new();

    let raw = get_json(&http, format!("{base_url}/offers/{offer_id}")).await?;
    let dto: ExpectedOfferDetailsDto =
        serde_json::from_value(raw).expect("response must match full DTO shape");

    assert_eq!(dto.status, "claimed");
    assert!(
        dto.utxos
            .iter()
            .any(|utxo| utxo.utxo_type == "active_offer" && utxo.spent_txid.is_some())
    );
    assert!(
        dto.utxos
            .iter()
            .all(|utxo| utxo.utxo_type != "active_offer" || utxo.spent_txid.is_some())
    );
    assert!(dto.borrower_principal_utxo.is_none());
    assert_eq!(dto.withdrawals.len(), 1);
    assert_eq!(dto.withdrawals[0].vault_type, "lender");
    assert!(dto.withdrawals[0].is_full);
    assert_eq!(
        dto.withdrawals[0].amount_withdrawn,
        lender_amount.to_string()
    );
    assert_eq!(dto.withdrawals[0].vault_amount_after, "0");
    assert!(dto.vaults.iter().all(|vault| vault.vault_type != "lender"));

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn borrower_overview_returns_totals_for_script() -> anyhow::Result<()> {
    let (base_url, server_handle, _pending, _active) = setup_seeded_api().await?;
    let http = reqwest::Client::new();

    let overview = get_json(
        &http,
        format!("{base_url}/borrowers/overview?script_pubkey=52ac"),
    )
    .await?;

    assert_eq!(overview["active_loans"], 1);
    assert_eq!(overview["pending_offers"], 1);
    assert_eq!(
        overview["collateral_locked"].as_array().map_or(0, Vec::len),
        1
    );
    assert_eq!(overview["collateral_locked"][0]["amount"], "2000");
    assert_eq!(overview["borrowings"].as_array().map_or(0, Vec::len), 1);
    assert_eq!(overview["borrowings"][0]["amount"], "1012");

    let unknown_wallet = get_json(
        &http,
        format!("{base_url}/borrowers/overview?script_pubkey=dead"),
    )
    .await?;
    assert_eq!(unknown_wallet["active_loans"], 0);
    assert_eq!(unknown_wallet["pending_offers"], 0);
    assert_eq!(
        unknown_wallet["collateral_locked"]
            .as_array()
            .map_or(0, Vec::len),
        0
    );

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn borrower_offers_returns_paginated_list_for_script() -> anyhow::Result<()> {
    let (base_url, server_handle, pending_offer, active_offer) = setup_seeded_api().await?;
    let http = reqwest::Client::new();

    let offers = get_json(
        &http,
        format!("{base_url}/borrowers/offers?script_pubkey=52ac"),
    )
    .await?;

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
                participant_script(item, "borrower") == Some("52ac")
                    && item["collateral_amount"].as_str() == Some("1000")
                    && item["principal_amount"].as_str() == Some("500")
            })
    );

    let active_item = find_list_item(&offers["items"], active_offer).expect("active offer");
    assert_eq!(participant_script(active_item, "lender"), Some("53ac"));
    assert_eq!(active_item["borrower_principal_utxo"]["vout"], 1);

    let pending_item = find_list_item(&offers["items"], pending_offer).expect("pending offer");
    assert_eq!(participant_script(pending_item, "lender"), Some("50ac"));
    assert!(pending_item.get("borrower_principal_utxo").is_none());

    let pending_only = get_json(
        &http,
        format!("{base_url}/borrowers/offers?script_pubkey=52ac&status=pending"),
    )
    .await?;
    assert_eq!(pending_only["total"], 1);
    assert_eq!(pending_only["items"][0]["id"], pending_offer.to_string());

    let unknown_wallet = get_json(
        &http,
        format!("{base_url}/borrowers/offers?script_pubkey=dead"),
    )
    .await?;
    assert_eq!(unknown_wallet["total"], 0);

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn borrower_overview_is_not_filtered_by_offer_list_params() -> anyhow::Result<()> {
    let (base_url, server_handle, _pending, _active) = setup_seeded_api().await?;
    let http = reqwest::Client::new();

    let overview = get_json(
        &http,
        format!("{base_url}/borrowers/overview?script_pubkey=52ac&status=pending"),
    )
    .await?;
    assert_eq!(overview["pending_offers"], 1);
    assert_eq!(overview["active_loans"], 1);

    server_handle.abort();
    Ok(())
}

const REPAID_OFFER_HEIGHT: i64 = 44;

async fn setup_seeded_lender_api() -> anyhow::Result<(String, tokio::task::JoinHandle<()>, i64, i64)>
{
    let pool = test_pool().await?;

    let factory_id = Uuid::new_v4();

    let factory = factory_model(
        factory_id,
        FACTORY_CREATION_HEIGHT,
        unique_32_bytes_from_uuid(factory_id),
    );
    seed_factory_row(&pool, &factory).await?;

    let active_offer = seed_offer_graph(
        &pool,
        factory_id,
        3,
        OfferStatus::Active,
        ACTIVE_OFFER_HEIGHT,
    )
    .await?;
    let repaid_offer = seed_offer_graph(
        &pool,
        factory_id,
        4,
        OfferStatus::Repaid,
        REPAID_OFFER_HEIGHT,
    )
    .await?;

    let (base_url, server_handle) = start_api(pool).await?;
    Ok((base_url, server_handle, active_offer, repaid_offer))
}

#[tokio::test]
#[serial]
async fn lender_overview_returns_active_and_repaid_totals() -> anyhow::Result<()> {
    let (base_url, server_handle, _active, _repaid) = setup_seeded_lender_api().await?;
    let http = reqwest::Client::new();

    let overview = get_json(
        &http,
        format!("{base_url}/lenders/overview?script_pubkey=53ac"),
    )
    .await?;

    assert_eq!(overview["active_loans"], 1);
    assert_eq!(overview["to_be_claimed"], 1);
    assert_eq!(overview["supplied_loans"].as_array().map_or(0, Vec::len), 1);
    assert_eq!(overview["supplied_loans"][0]["amount"], "506");
    assert_eq!(
        overview["interest_outstanding"]
            .as_array()
            .map_or(0, Vec::len),
        1
    );
    assert_eq!(overview["interest_outstanding"][0]["amount"], "6");

    let unknown_wallet = get_json(
        &http,
        format!("{base_url}/lenders/overview?script_pubkey=dead"),
    )
    .await?;
    assert_eq!(unknown_wallet["active_loans"], 0);
    assert_eq!(unknown_wallet["to_be_claimed"], 0);

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn lender_offers_excludes_pending_without_matching_lender_script() -> anyhow::Result<()> {
    let (base_url, server_handle, pending_offer, active_offer) = setup_seeded_api().await?;
    let http = reqwest::Client::new();

    let offers = get_json(
        &http,
        format!("{base_url}/lenders/offers?script_pubkey=53ac"),
    )
    .await?;

    assert_eq!(offers["total"], 1);
    assert_eq!(offers["items"][0]["id"], active_offer.to_string());
    assert_ne!(offers["items"][0]["id"], pending_offer.to_string());
    assert_eq!(
        participant_script(&offers["items"][0], "lender"),
        Some("53ac")
    );
    assert_eq!(offers["items"][0]["borrower_principal_utxo"]["vout"], 1);

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn lender_overview_is_not_filtered_by_offer_list_params() -> anyhow::Result<()> {
    let (base_url, server_handle, _active, _repaid) = setup_seeded_lender_api().await?;
    let http = reqwest::Client::new();

    let overview = get_json(
        &http,
        format!("{base_url}/lenders/overview?script_pubkey=53ac&status=active"),
    )
    .await?;
    assert_eq!(overview["active_loans"], 1);
    assert_eq!(overview["to_be_claimed"], 1);

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn lender_offers_returns_paginated_list_for_script() -> anyhow::Result<()> {
    let (base_url, server_handle, active_offer, repaid_offer) = setup_seeded_lender_api().await?;
    let http = reqwest::Client::new();

    let offers = get_json(
        &http,
        format!("{base_url}/lenders/offers?script_pubkey=53ac"),
    )
    .await?;

    assert_eq!(offers["total"], 2);
    assert_ids_match_unordered(&offers["items"], &[active_offer, repaid_offer]);

    for item in offers["items"].as_array().into_iter().flatten() {
        assert_eq!(participant_script(item, "borrower"), Some("52ac"));
        assert_eq!(participant_script(item, "lender"), Some("53ac"));
    }
    let active_item = find_list_item(&offers["items"], active_offer).expect("active offer");
    assert_eq!(active_item["borrower_principal_utxo"]["vout"], 1);
    let repaid_item = find_list_item(&offers["items"], repaid_offer).expect("repaid offer");
    assert!(repaid_item.get("borrower_principal_utxo").is_none());

    let active_only = get_json(
        &http,
        format!("{base_url}/lenders/offers?script_pubkey=53ac&status=active"),
    )
    .await?;
    assert_eq!(active_only["total"], 1);
    assert_eq!(active_only["items"][0]["id"], active_offer.to_string());

    server_handle.abort();
    Ok(())
}
