mod common;

use std::collections::HashMap;
use std::collections::HashSet;
use std::sync::Arc;

use std::str::FromStr;

use axum::{
    Router,
    body::Body,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};
use lending_contracts::{programs::PreLockParameters, utils::LendingOfferParameters};
use lending_indexer::esplora_client::EsploraClient;
use lending_indexer::indexer::{
    UtxoCache, get_last_indexed_height, handle_pre_lock_creation, load_utxo_cache, process_block,
    process_tx, upsert_sync_state,
};
use lending_indexer::models::{
    ActiveUtxo, OfferStatus, OfferUtxoModel, ParticipantType, UtxoData, UtxoType,
};
use serial_test::serial;
use simplex::provider::SimplicityNetwork;
use simplex::simplicityhl::elements::{
    AssetId, OutPoint, Script, TxOut, Txid, encode, hashes::Hash, secp256k1_zkp::XOnlyPublicKey,
};
use sqlx::{PgPool, Row};
use tokio::net::TcpListener;
use uuid::Uuid;

use crate::common::{
    FIXED_BORROWER_PUBKEY_HEX, explicit_asset_output, non_op_return_script, normal_output,
    null_data_output, offer_model, outpoint_with_txid_byte, padded_tx_with_inputs, seed_offer_row,
    seed_offer_utxo_row, seed_participant_utxo_row, spent_offer_utxo, spent_participant, test_pool,
    tx_with_input, unspent_offer_utxo, unspent_participant,
};

#[derive(Clone)]
struct MockEsploraState {
    block_hash: String,
    txids: Vec<String>,
    tx_bytes_by_id: HashMap<String, Vec<u8>>,
}

async fn start_mock_esplora(
    state: MockEsploraState,
) -> anyhow::Result<(String, tokio::task::JoinHandle<()>)> {
    async fn get_block_hash(
        State(state): State<Arc<MockEsploraState>>,
        Path(_height): Path<u64>,
    ) -> impl IntoResponse {
        state.block_hash.clone()
    }

    async fn get_block_txids(
        State(state): State<Arc<MockEsploraState>>,
        Path(_hash): Path<String>,
    ) -> impl IntoResponse {
        axum::Json(state.txids.clone())
    }

    async fn get_raw_tx(
        State(state): State<Arc<MockEsploraState>>,
        Path(txid): Path<String>,
    ) -> impl IntoResponse {
        match state.tx_bytes_by_id.get(&txid) {
            Some(bytes) => (
                StatusCode::OK,
                [(axum::http::header::CONTENT_TYPE, "application/octet-stream")],
                Body::from(bytes.clone()),
            )
                .into_response(),
            None => (StatusCode::NOT_FOUND, "not found").into_response(),
        }
    }

    let app = Router::new()
        .route("/block-height/{height}", get(get_block_hash))
        .route("/block/{hash}/txids", get(get_block_txids))
        .route("/tx/{txid}/raw", get(get_raw_tx))
        .with_state(Arc::new(state));

    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let addr = listener.local_addr()?;
    let handle = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });

    Ok((format!("http://{addr}"), handle))
}

async fn seed_offer_with_pre_lock(
    pool: &PgPool,
    offer_id: Uuid,
    outpoint: OutPoint,
    created_at_height: i64,
) -> anyhow::Result<()> {
    // Mirrors production: `handle_pre_lock_creation` stores the pre-lock
    // txid as `created_at_txid`.
    let mut offer = offer_model(
        offer_id,
        created_at_height,
        outpoint.txid.as_byte_array().to_vec(),
    );
    offer.current_status = lending_indexer::models::OfferStatus::Pending;
    seed_offer_row(pool, &offer).await?;

    let pre_lock = unspent_offer_utxo(offer_id, outpoint, UtxoType::PreLock, created_at_height);
    seed_offer_utxo_row(pool, &pre_lock).await?;

    Ok(())
}

async fn offer_utxo_type_spent_set(
    pool: &PgPool,
    offer_id: Uuid,
) -> anyhow::Result<HashSet<(String, bool)>> {
    let rows = sqlx::query(
        "SELECT utxo_type::text AS utxo_type, spent_txid IS NOT NULL AS is_spent \
         FROM offer_utxos WHERE offer_id = $1",
    )
    .bind(offer_id)
    .fetch_all(pool)
    .await?;

    let mut set = HashSet::new();
    for row in rows {
        let utxo_type: String = row.get("utxo_type");
        let is_spent: bool = row.get("is_spent");
        set.insert((utxo_type, is_spent));
    }
    Ok(set)
}

async fn count_offer_utxos(
    pool: &PgPool,
    offer_id: Uuid,
    utxo_type: &str,
    spent: Option<bool>,
) -> anyhow::Result<i64> {
    let query_text = match spent {
        Some(true) => {
            "SELECT COUNT(*)::BIGINT AS c FROM offer_utxos \
             WHERE offer_id = $1 AND utxo_type::text = $2 AND spent_txid IS NOT NULL"
        }
        Some(false) => {
            "SELECT COUNT(*)::BIGINT AS c FROM offer_utxos \
             WHERE offer_id = $1 AND utxo_type::text = $2 AND spent_txid IS NULL"
        }
        None => {
            "SELECT COUNT(*)::BIGINT AS c FROM offer_utxos \
             WHERE offer_id = $1 AND utxo_type::text = $2"
        }
    };
    let row = sqlx::query(query_text)
        .bind(offer_id)
        .bind(utxo_type)
        .fetch_one(pool)
        .await?;
    Ok(row.get::<i64, _>("c"))
}

async fn count_participants(
    pool: &PgPool,
    offer_id: Uuid,
    participant_type: &str,
    spent: Option<bool>,
) -> anyhow::Result<i64> {
    let query_text = match spent {
        Some(true) => {
            "SELECT COUNT(*)::BIGINT AS c FROM offer_participants \
             WHERE offer_id = $1 AND participant_type::text = $2 AND spent_txid IS NOT NULL"
        }
        Some(false) => {
            "SELECT COUNT(*)::BIGINT AS c FROM offer_participants \
             WHERE offer_id = $1 AND participant_type::text = $2 AND spent_txid IS NULL"
        }
        None => {
            "SELECT COUNT(*)::BIGINT AS c FROM offer_participants \
             WHERE offer_id = $1 AND participant_type::text = $2"
        }
    };
    let row = sqlx::query(query_text)
        .bind(offer_id)
        .bind(participant_type)
        .fetch_one(pool)
        .await?;
    Ok(row.get::<i64, _>("c"))
}

async fn current_status(pool: &PgPool, offer_id: Uuid) -> anyhow::Result<String> {
    let row = sqlx::query("SELECT current_status::text AS s FROM offers WHERE id = $1")
        .bind(offer_id)
        .fetch_one(pool)
        .await?;
    Ok(row.get::<String, _>("s"))
}

async fn sync_state_row_count(pool: &PgPool) -> anyhow::Result<i64> {
    let row = sqlx::query("SELECT COUNT(*)::BIGINT AS c FROM sync_state")
        .fetch_one(pool)
        .await?;
    Ok(row.get::<i64, _>("c"))
}

#[tokio::test]
#[serial]
async fn process_tx_full_repay_then_claim_lifecycle() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let mut cache = UtxoCache::new();
    let client = EsploraClient::new();

    let offer_id = Uuid::new_v4();
    let pre_lock_outpoint = outpoint_with_txid_byte(11, 0);
    seed_offer_with_pre_lock(&pool, offer_id, pre_lock_outpoint, 100).await?;
    cache.insert(
        pre_lock_outpoint,
        ActiveUtxo {
            offer_id,
            data: UtxoData::Offer(UtxoType::PreLock),
        },
    );

    // Dispatch: all outputs non-null-data -> lending path (not cancellation).
    // Pad to 7 inputs so the tx matches the shape of a real lending-creation
    // spend even if the dispatcher later adds an input-count guard.
    let lending_tx = padded_tx_with_inputs(vec![pre_lock_outpoint], vec![normal_output(); 5]);
    {
        let mut sql_tx = pool.begin().await?;
        process_tx(&mut sql_tx, &lending_tx, &mut cache, &client, 101).await?;
        sql_tx.commit().await?;
    }

    // Dispatch: output[1] non-null + [2, 3, 4] null-data -> repayment path.
    let lending_outpoint = OutPoint {
        txid: lending_tx.txid(),
        vout: 0,
    };
    let repayment_tx = tx_with_input(
        lending_outpoint,
        vec![
            normal_output(),
            normal_output(),
            null_data_output(),
            null_data_output(),
            null_data_output(),
        ],
    );
    {
        let mut sql_tx = pool.begin().await?;
        process_tx(&mut sql_tx, &repayment_tx, &mut cache, &client, 102).await?;
        sql_tx.commit().await?;
    }

    let repayment_outpoint = OutPoint {
        txid: repayment_tx.txid(),
        vout: 1,
    };
    let claim_tx = tx_with_input(repayment_outpoint, vec![normal_output(), normal_output()]);
    {
        let mut sql_tx = pool.begin().await?;
        process_tx(&mut sql_tx, &claim_tx, &mut cache, &client, 103).await?;
        sql_tx.commit().await?;
    }

    assert_eq!(current_status(&pool, offer_id).await?, "claimed");

    let utxos = offer_utxo_type_spent_set(&pool, offer_id).await?;
    let expected: HashSet<(String, bool)> = [
        ("pre_lock".to_string(), true),
        ("lending".to_string(), true),
        ("repayment".to_string(), true),
        ("claim".to_string(), true),
    ]
    .into_iter()
    .collect();
    assert_eq!(utxos, expected);

    assert!(cache.get(&pre_lock_outpoint).is_none());
    assert!(cache.get(&lending_outpoint).is_none());
    assert!(cache.get(&repayment_outpoint).is_none());

    Ok(())
}

#[tokio::test]
#[serial]
async fn process_tx_liquidation_updates_offer_and_archives_utxo() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let mut cache = UtxoCache::new();
    let client = EsploraClient::new();

    let offer_id = Uuid::new_v4();
    let pre_lock_outpoint = outpoint_with_txid_byte(22, 0);
    seed_offer_with_pre_lock(&pool, offer_id, pre_lock_outpoint, 200).await?;
    cache.insert(
        pre_lock_outpoint,
        ActiveUtxo {
            offer_id,
            data: UtxoData::Offer(UtxoType::PreLock),
        },
    );

    let lending_tx = padded_tx_with_inputs(vec![pre_lock_outpoint], vec![normal_output(); 5]);
    {
        let mut sql_tx = pool.begin().await?;
        process_tx(&mut sql_tx, &lending_tx, &mut cache, &client, 201).await?;
        sql_tx.commit().await?;
    }

    // Dispatch: outputs [1, 2, 3] null-data, [4] non-null -> liquidation path.
    let lending_outpoint = OutPoint {
        txid: lending_tx.txid(),
        vout: 0,
    };
    let liquidation_tx = tx_with_input(
        lending_outpoint,
        vec![
            normal_output(),
            null_data_output(),
            null_data_output(),
            null_data_output(),
            normal_output(),
        ],
    );
    {
        let mut sql_tx = pool.begin().await?;
        process_tx(&mut sql_tx, &liquidation_tx, &mut cache, &client, 202).await?;
        sql_tx.commit().await?;
    }

    assert_eq!(current_status(&pool, offer_id).await?, "liquidated");
    // Pins: liquidation handler inserts the post-liquidation utxo as already
    // spent (audit trail stays, cache drops it on restart).
    assert_eq!(
        count_offer_utxos(&pool, offer_id, "repayment", Some(true)).await?,
        1
    );
    assert_eq!(
        count_offer_utxos(&pool, offer_id, "repayment", Some(false)).await?,
        0
    );

    Ok(())
}

#[tokio::test]
#[serial]
async fn process_tx_prelock_to_cancellation_sets_status_and_archives() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let mut cache = UtxoCache::new();
    let client = EsploraClient::new();

    let offer_id = Uuid::new_v4();
    let pre_lock_outpoint = outpoint_with_txid_byte(55, 0);
    seed_offer_with_pre_lock(&pool, offer_id, pre_lock_outpoint, 400).await?;
    cache.insert(
        pre_lock_outpoint,
        ActiveUtxo {
            offer_id,
            data: UtxoData::Offer(UtxoType::PreLock),
        },
    );

    // Dispatch: all non-coin outputs null-data -> cancellation path.
    let cancellation_tx = tx_with_input(
        pre_lock_outpoint,
        vec![
            normal_output(),
            null_data_output(),
            null_data_output(),
            null_data_output(),
            null_data_output(),
        ],
    );
    {
        let mut sql_tx = pool.begin().await?;
        process_tx(&mut sql_tx, &cancellation_tx, &mut cache, &client, 401).await?;
        sql_tx.commit().await?;
    }

    assert_eq!(current_status(&pool, offer_id).await?, "cancelled");
    assert_eq!(
        count_offer_utxos(&pool, offer_id, "cancellation", Some(true)).await?,
        1
    );

    Ok(())
}

#[tokio::test]
#[serial]
async fn participant_movement_updates_history_and_handles_burn() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let mut cache = UtxoCache::new();
    let client = EsploraClient::new();

    let offer_id = Uuid::new_v4();
    let pre_lock_outpoint = outpoint_with_txid_byte(66, 0);
    seed_offer_with_pre_lock(&pool, offer_id, pre_lock_outpoint, 500).await?;

    let borrower_outpoint = outpoint_with_txid_byte(67, 1);
    seed_participant_utxo_row(
        &pool,
        &unspent_participant(
            offer_id,
            ParticipantType::Borrower,
            borrower_outpoint,
            vec![0x51, 0xac],
            501,
        ),
    )
    .await?;
    cache.insert(
        borrower_outpoint,
        ActiveUtxo {
            offer_id,
            data: UtxoData::Participant(ParticipantType::Borrower),
        },
    );

    let move_tx = tx_with_input(
        borrower_outpoint,
        vec![explicit_asset_output(7, non_op_return_script())],
    );
    {
        let mut sql_tx = pool.begin().await?;
        process_tx(&mut sql_tx, &move_tx, &mut cache, &client, 502).await?;
        sql_tx.commit().await?;
    }

    let new_borrower_outpoint = OutPoint {
        txid: move_tx.txid(),
        vout: 0,
    };
    assert!(cache.get(&borrower_outpoint).is_none());
    assert!(cache.get(&new_borrower_outpoint).is_some());
    assert_eq!(
        count_participants(&pool, offer_id, "borrower", Some(false)).await?,
        1
    );
    assert_eq!(
        count_participants(&pool, offer_id, "borrower", Some(true)).await?,
        1
    );

    // Pins: burn via OP_RETURN marks the old row spent and does NOT insert
    // a new participant row.
    let burn_tx = tx_with_input(
        new_borrower_outpoint,
        vec![explicit_asset_output(7, Script::new_op_return(b"burn"))],
    );
    {
        let mut sql_tx = pool.begin().await?;
        process_tx(&mut sql_tx, &burn_tx, &mut cache, &client, 503).await?;
        sql_tx.commit().await?;
    }

    assert!(cache.get(&new_borrower_outpoint).is_none());
    assert_eq!(
        count_participants(&pool, offer_id, "borrower", Some(false)).await?,
        0
    );
    assert_eq!(
        count_participants(&pool, offer_id, "borrower", Some(true)).await?,
        2
    );

    Ok(())
}

#[tokio::test]
#[serial]
async fn participant_move_without_target_asset_marks_spent_without_new_utxo() -> anyhow::Result<()>
{
    let pool = test_pool().await?;
    let mut cache = UtxoCache::new();
    let client = EsploraClient::new();

    let offer_id = Uuid::new_v4();
    let pre_lock_outpoint = outpoint_with_txid_byte(74, 0);
    seed_offer_with_pre_lock(&pool, offer_id, pre_lock_outpoint, 530).await?;

    let borrower_outpoint = outpoint_with_txid_byte(75, 1);
    seed_participant_utxo_row(
        &pool,
        &unspent_participant(
            offer_id,
            ParticipantType::Borrower,
            borrower_outpoint,
            vec![0x51, 0xac],
            531,
        ),
    )
    .await?;
    cache.insert(
        borrower_outpoint,
        ActiveUtxo {
            offer_id,
            data: UtxoData::Participant(ParticipantType::Borrower),
        },
    );

    // Output asset byte = 9, but the seeded `borrower_nft_asset_id` is
    // `[7; 32]` -> handler sees no matching output for the NFT.
    let move_without_target_asset_tx = tx_with_input(
        borrower_outpoint,
        vec![explicit_asset_output(9, non_op_return_script())],
    );
    {
        let mut sql_tx = pool.begin().await?;
        process_tx(
            &mut sql_tx,
            &move_without_target_asset_tx,
            &mut cache,
            &client,
            532,
        )
        .await?;
        sql_tx.commit().await?;
    }

    assert!(cache.get(&borrower_outpoint).is_none());
    assert_eq!(
        count_participants(&pool, offer_id, "borrower", Some(false)).await?,
        0
    );
    assert_eq!(
        count_participants(&pool, offer_id, "borrower", Some(true)).await?,
        1
    );

    Ok(())
}

#[tokio::test]
#[serial]
async fn single_tx_with_multiple_known_inputs_applies_all_transitions() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let mut cache = UtxoCache::new();
    let client = EsploraClient::new();

    let offer_id = Uuid::new_v4();
    let pre_lock_outpoint = outpoint_with_txid_byte(72, 0);
    seed_offer_with_pre_lock(&pool, offer_id, pre_lock_outpoint, 520).await?;
    cache.insert(
        pre_lock_outpoint,
        ActiveUtxo {
            offer_id,
            data: UtxoData::Offer(UtxoType::PreLock),
        },
    );

    let borrower_outpoint = outpoint_with_txid_byte(73, 1);
    seed_participant_utxo_row(
        &pool,
        &unspent_participant(
            offer_id,
            ParticipantType::Borrower,
            borrower_outpoint,
            vec![0x51, 0xac],
            521,
        ),
    )
    .await?;
    cache.insert(
        borrower_outpoint,
        ActiveUtxo {
            offer_id,
            data: UtxoData::Participant(ParticipantType::Borrower),
        },
    );

    // vout 0 becomes the new Lending UTXO, vout 1 carries the moved
    // borrower NFT (asset byte 7 matches seeded `borrower_nft_asset_id`).
    // Pad to 7 inputs so the pre-lock -> lending dispatch sees a valid shape.
    let combined_tx = padded_tx_with_inputs(
        vec![pre_lock_outpoint, borrower_outpoint],
        vec![
            normal_output(),
            explicit_asset_output(7, non_op_return_script()),
            normal_output(),
            normal_output(),
            normal_output(),
        ],
    );

    let mut sql_tx = pool.begin().await?;
    process_tx(&mut sql_tx, &combined_tx, &mut cache, &client, 522).await?;
    sql_tx.commit().await?;

    assert_eq!(current_status(&pool, offer_id).await?, "active");

    let lending_outpoint = OutPoint {
        txid: combined_tx.txid(),
        vout: 0,
    };
    let moved_borrower_outpoint = OutPoint {
        txid: combined_tx.txid(),
        vout: 1,
    };
    assert!(cache.get(&pre_lock_outpoint).is_none());
    assert!(cache.get(&borrower_outpoint).is_none());
    assert!(cache.get(&lending_outpoint).is_some());
    assert!(cache.get(&moved_borrower_outpoint).is_some());

    assert_eq!(
        count_participants(&pool, offer_id, "borrower", Some(false)).await?,
        1
    );

    Ok(())
}

#[tokio::test]
#[serial]
async fn process_block_rolls_back_db_and_cache_when_later_tx_fails() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let mut cache = UtxoCache::new();

    // Valid offer whose pre-lock the first tx of the block will consume.
    let valid_offer_id = Uuid::new_v4();
    let valid_prelock_outpoint = outpoint_with_txid_byte(33, 0);
    seed_offer_with_pre_lock(&pool, valid_offer_id, valid_prelock_outpoint, 300).await?;
    cache.insert(
        valid_prelock_outpoint,
        ActiveUtxo {
            offer_id: valid_offer_id,
            data: UtxoData::Offer(UtxoType::PreLock),
        },
    );

    // Cached participant pointing at an offer_id that does NOT exist in the
    // DB -> participant handler hits `RowNotFound` and aborts the block.
    let missing_offer_id = Uuid::new_v4();
    let missing_participant_outpoint = outpoint_with_txid_byte(44, 1);
    cache.insert(
        missing_participant_outpoint,
        ActiveUtxo {
            offer_id: missing_offer_id,
            data: UtxoData::Participant(ParticipantType::Borrower),
        },
    );

    let good_tx = padded_tx_with_inputs(vec![valid_prelock_outpoint], vec![normal_output(); 5]);
    let bad_tx = tx_with_input(missing_participant_outpoint, vec![normal_output()]);

    let mut tx_bytes_by_id = HashMap::new();
    tx_bytes_by_id.insert(good_tx.txid().to_string(), encode::serialize(&good_tx));
    tx_bytes_by_id.insert(bad_tx.txid().to_string(), encode::serialize(&bad_tx));

    let (base_url, server_handle) = start_mock_esplora(MockEsploraState {
        block_hash: "integration-block-hash-1".to_string(),
        txids: vec![good_tx.txid().to_string(), bad_tx.txid().to_string()],
        tx_bytes_by_id,
    })
    .await?;
    let client = EsploraClient::with_base_url(&base_url);

    let result = process_block(&pool, &client, &mut cache, 301).await;
    assert!(result.is_err());

    assert_eq!(current_status(&pool, valid_offer_id).await?, "pending");
    assert_eq!(
        count_offer_utxos(&pool, valid_offer_id, "pre_lock", Some(false)).await?,
        1
    );
    assert_eq!(
        count_offer_utxos(&pool, valid_offer_id, "lending", None).await?,
        0
    );
    assert_eq!(sync_state_row_count(&pool).await?, 0);

    // Cache rolled back: originals intact, optimistic insert from good_tx gone.
    assert!(cache.get(&valid_prelock_outpoint).is_some());
    assert!(cache.get(&missing_participant_outpoint).is_some());
    let rolled_back_lending_outpoint = OutPoint {
        txid: good_tx.txid(),
        vout: 0,
    };
    assert!(cache.get(&rolled_back_lending_outpoint).is_none());

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn process_block_successfully_commits_sync_state_and_cache() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let mut cache = UtxoCache::new();

    let offer_id = Uuid::new_v4();
    let pre_lock_outpoint = outpoint_with_txid_byte(70, 0);
    seed_offer_with_pre_lock(&pool, offer_id, pre_lock_outpoint, 510).await?;
    cache.insert(
        pre_lock_outpoint,
        ActiveUtxo {
            offer_id,
            data: UtxoData::Offer(UtxoType::PreLock),
        },
    );

    let borrower_outpoint = outpoint_with_txid_byte(71, 1);
    seed_participant_utxo_row(
        &pool,
        &unspent_participant(
            offer_id,
            ParticipantType::Borrower,
            borrower_outpoint,
            vec![0x51, 0xac],
            511,
        ),
    )
    .await?;
    cache.insert(
        borrower_outpoint,
        ActiveUtxo {
            offer_id,
            data: UtxoData::Participant(ParticipantType::Borrower),
        },
    );

    let lending_tx = padded_tx_with_inputs(vec![pre_lock_outpoint], vec![normal_output(); 5]);
    let move_tx = tx_with_input(
        borrower_outpoint,
        vec![explicit_asset_output(7, non_op_return_script())],
    );

    let mut tx_bytes_by_id = HashMap::new();
    tx_bytes_by_id.insert(
        lending_tx.txid().to_string(),
        encode::serialize(&lending_tx),
    );
    tx_bytes_by_id.insert(move_tx.txid().to_string(), encode::serialize(&move_tx));
    let block_hash = "integration-block-hash-success".to_string();

    let (base_url, server_handle) = start_mock_esplora(MockEsploraState {
        block_hash: block_hash.clone(),
        txids: vec![lending_tx.txid().to_string(), move_tx.txid().to_string()],
        tx_bytes_by_id,
    })
    .await?;
    let client = EsploraClient::with_base_url(&base_url);

    process_block(&pool, &client, &mut cache, 512).await?;

    let sync =
        sqlx::query("SELECT last_indexed_height, last_indexed_hash FROM sync_state WHERE id = 1")
            .fetch_one(&pool)
            .await?;
    assert_eq!(sync.get::<i64, _>("last_indexed_height"), 512);
    assert_eq!(sync.get::<String, _>("last_indexed_hash"), block_hash);

    let lending_outpoint = OutPoint {
        txid: lending_tx.txid(),
        vout: 0,
    };
    let moved_borrower_outpoint = OutPoint {
        txid: move_tx.txid(),
        vout: 0,
    };
    assert!(cache.get(&pre_lock_outpoint).is_none());
    assert!(cache.get(&borrower_outpoint).is_none());
    assert!(cache.get(&lending_outpoint).is_some());
    assert!(cache.get(&moved_borrower_outpoint).is_some());

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn restart_helpers_restore_height_and_only_unspent_cache_entries() -> anyhow::Result<()> {
    let pool = test_pool().await?;

    // Pins: fallback-to-config height when sync_state is empty.
    let fallback_height = get_last_indexed_height(&pool, 999).await?;
    assert_eq!(fallback_height, 999);

    let mut sql_tx = pool.begin().await?;
    upsert_sync_state(&mut sql_tx, 777, "hash-777".to_string()).await?;
    sql_tx.commit().await?;
    assert_eq!(get_last_indexed_height(&pool, 999).await?, 777);

    // Pins `load_utxo_cache`'s `WHERE spent_txid IS NULL` invariant.
    let offer_id = Uuid::new_v4();
    let pre_lock_outpoint = outpoint_with_txid_byte(88, 0);
    seed_offer_with_pre_lock(&pool, offer_id, pre_lock_outpoint, 600).await?;

    let spent_lending_outpoint = outpoint_with_txid_byte(90, 1);
    seed_offer_utxo_row(
        &pool,
        &spent_offer_utxo(
            offer_id,
            spent_lending_outpoint,
            UtxoType::Lending,
            601,
            602,
            0xab,
        ),
    )
    .await?;

    let unspent_lender_outpoint = outpoint_with_txid_byte(89, 2);
    seed_participant_utxo_row(
        &pool,
        &unspent_participant(
            offer_id,
            ParticipantType::Lender,
            unspent_lender_outpoint,
            vec![0x52, 0xac],
            601,
        ),
    )
    .await?;

    let spent_borrower_outpoint = outpoint_with_txid_byte(91, 3);
    seed_participant_utxo_row(
        &pool,
        &spent_participant(
            offer_id,
            ParticipantType::Borrower,
            spent_borrower_outpoint,
            vec![0x51, 0xac],
            600,
            601,
            0xcd,
        ),
    )
    .await?;

    let restored_cache = load_utxo_cache(&pool).await?;
    assert!(restored_cache.get(&pre_lock_outpoint).is_some());
    assert!(restored_cache.get(&unspent_lender_outpoint).is_some());
    assert!(restored_cache.get(&spent_lending_outpoint).is_none());
    assert!(restored_cache.get(&spent_borrower_outpoint).is_none());

    Ok(())
}

#[tokio::test]
#[serial]
async fn process_block_returns_error_on_invalid_esplora_tx_payload() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let mut cache = UtxoCache::new();

    let bogus_txid = Txid::from_slice(&[99; 32])?;
    let (base_url, server_handle) = start_mock_esplora(MockEsploraState {
        block_hash: "integration-block-hash-invalid".to_string(),
        txids: vec![bogus_txid.to_string()],
        tx_bytes_by_id: HashMap::from([(bogus_txid.to_string(), vec![0x01, 0x02, 0x03])]),
    })
    .await?;
    let client = EsploraClient::with_base_url(&base_url);

    let result = process_block(&pool, &client, &mut cache, 700).await;
    assert!(result.is_err());
    assert_eq!(sync_state_row_count(&pool).await?, 0);

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn process_block_returns_error_on_esplora_http_500() -> anyhow::Result<()> {
    async fn block_height_500() -> impl IntoResponse {
        (StatusCode::INTERNAL_SERVER_ERROR, "boom")
    }

    let pool = test_pool().await?;
    let mut cache = UtxoCache::new();

    let app = Router::new().route("/block-height/{height}", get(block_height_500));
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let addr = listener.local_addr()?;
    let server_handle = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });

    let client = EsploraClient::with_base_url(&format!("http://{addr}"));
    let result = process_block(&pool, &client, &mut cache, 900).await;
    assert!(result.is_err());
    assert_eq!(sync_state_row_count(&pool).await?, 0);

    server_handle.abort();
    Ok(())
}

// Intent: these tests drive `handle_pre_lock_creation` directly with
// synthesized parameters. Going through `is_pre_lock_creation_tx` would
// require a real Simplex PreLock script in output[0] and a provider capable
// of fetching the collateral tx, which is out of scope for DB-level
// integration tests. The gatekeeper is covered by its own unit tests;
// everything after it (DB rows + cache inserts) is exercised here.

fn synthesized_pre_lock_parameters() -> PreLockParameters {
    PreLockParameters {
        collateral_asset_id: AssetId::from_slice(&[0xc0_u8; 32]).expect("asset"),
        principal_asset_id: AssetId::from_slice(&[0xd1_u8; 32]).expect("asset"),
        first_parameters_nft_asset_id: AssetId::from_slice(&[0xf1_u8; 32]).expect("asset"),
        second_parameters_nft_asset_id: AssetId::from_slice(&[0xf2_u8; 32]).expect("asset"),
        borrower_nft_asset_id: AssetId::from_slice(&[0xbb_u8; 32]).expect("asset"),
        lender_nft_asset_id: AssetId::from_slice(&[0x1e_u8; 32]).expect("asset"),
        offer_parameters: LendingOfferParameters {
            collateral_amount: 1_000,
            principal_amount: 500,
            loan_expiration_time: 12_345,
            principal_interest_rate: 250,
        },
        borrower_pubkey: XOnlyPublicKey::from_str(FIXED_BORROWER_PUBKEY_HEX)
            .expect("valid xonly key"),
        borrower_output_script_hash: [0x9a_u8; 32],
        network: SimplicityNetwork::LiquidTestnet,
    }
}

/// Pins: handler contract requires >= 7 outputs, reads the borrower script
/// from vout 3 and the lender script from vout 4.
fn pre_lock_shaped_tx(
    input_outpoint: OutPoint,
    borrower_script: Script,
    lender_script: Script,
) -> simplex::simplicityhl::elements::Transaction {
    let make_with_script = |script_pubkey: Script| TxOut {
        script_pubkey,
        ..Default::default()
    };
    tx_with_input(
        input_outpoint,
        vec![
            normal_output(),
            normal_output(),
            normal_output(),
            make_with_script(borrower_script),
            make_with_script(lender_script),
            normal_output(),
            normal_output(),
        ],
    )
}

#[tokio::test]
#[serial]
async fn process_tx_pre_lock_creation_inserts_offer_and_participants() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let mut cache = UtxoCache::new();

    let params = synthesized_pre_lock_parameters();
    let borrower_script = Script::from(vec![0xaa_u8, 0xbb]);
    let lender_script = Script::from(vec![0xcc_u8, 0xdd]);
    let tx = pre_lock_shaped_tx(
        outpoint_with_txid_byte(0x10, 0),
        borrower_script.clone(),
        lender_script.clone(),
    );
    let txid = tx.txid();

    {
        let mut sql_tx = pool.begin().await?;
        handle_pre_lock_creation(&mut sql_tx, &mut cache, params, &tx, 1_000).await?;
        sql_tx.commit().await?;
    }

    let offer_row = sqlx::query(
        "SELECT id, current_status::text AS s, created_at_txid \
         FROM offers",
    )
    .fetch_all(&pool)
    .await?;
    assert_eq!(offer_row.len(), 1, "exactly one offer row expected");
    let offer_id: Uuid = offer_row[0].get("id");
    assert_eq!(offer_row[0].get::<String, _>("s"), "pending");
    assert_eq!(
        offer_row[0].get::<Vec<u8>, _>("created_at_txid"),
        txid.as_byte_array().to_vec()
    );

    let pre_lock_rows = sqlx::query(
        "SELECT vout, utxo_type::text AS t, spent_txid FROM offer_utxos WHERE offer_id = $1",
    )
    .bind(offer_id)
    .fetch_all(&pool)
    .await?;
    assert_eq!(pre_lock_rows.len(), 1);
    assert_eq!(pre_lock_rows[0].get::<i32, _>("vout"), 0);
    assert_eq!(pre_lock_rows[0].get::<String, _>("t"), "pre_lock");
    assert!(
        pre_lock_rows[0]
            .get::<Option<Vec<u8>>, _>("spent_txid")
            .is_none(),
        "pre-lock UTXO must be unspent"
    );

    let participants = sqlx::query(
        "SELECT participant_type::text AS pt, vout, script_pubkey, spent_txid \
         FROM offer_participants WHERE offer_id = $1 ORDER BY vout",
    )
    .bind(offer_id)
    .fetch_all(&pool)
    .await?;
    assert_eq!(participants.len(), 2);
    assert_eq!(participants[0].get::<String, _>("pt"), "borrower");
    assert_eq!(participants[0].get::<i32, _>("vout"), 3);
    assert_eq!(
        participants[0].get::<Vec<u8>, _>("script_pubkey"),
        borrower_script.to_bytes().to_vec()
    );
    assert!(
        participants[0]
            .get::<Option<Vec<u8>>, _>("spent_txid")
            .is_none()
    );
    assert_eq!(participants[1].get::<String, _>("pt"), "lender");
    assert_eq!(participants[1].get::<i32, _>("vout"), 4);
    assert_eq!(
        participants[1].get::<Vec<u8>, _>("script_pubkey"),
        lender_script.to_bytes().to_vec()
    );

    let pre_lock_op = OutPoint { txid, vout: 0 };
    let borrower_op = OutPoint { txid, vout: 3 };
    let lender_op = OutPoint { txid, vout: 4 };
    assert!(cache.get(&pre_lock_op).is_some(), "pre-lock must be cached");
    assert!(
        cache.get(&borrower_op).is_some(),
        "borrower NFT must be cached"
    );
    assert!(cache.get(&lender_op).is_some(), "lender NFT must be cached");

    Ok(())
}

/// Regression: re-processing the same pre-lock transaction must be a no-op
/// (replay, at-least-once delivery, crash-resume). The handler detects the
/// duplicate via `insert_offer`'s `ON CONFLICT (created_at_txid)` short
/// circuit and bails out before touching `offer_utxos` / `offer_participants`.
#[tokio::test]
#[serial]
async fn handle_pre_lock_creation_is_idempotent_on_replay() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let mut cache = UtxoCache::new();

    let params = synthesized_pre_lock_parameters();
    let tx = pre_lock_shaped_tx(
        outpoint_with_txid_byte(0x20, 0),
        Script::from(vec![0x51]),
        Script::from(vec![0x52]),
    );

    {
        let mut sql_tx = pool.begin().await?;
        handle_pre_lock_creation(&mut sql_tx, &mut cache, params, &tx, 2_000).await?;
        sql_tx.commit().await?;
    }

    {
        let mut sql_tx = pool.begin().await?;
        handle_pre_lock_creation(&mut sql_tx, &mut cache, params, &tx, 2_000).await?;
        sql_tx.commit().await?;
    }

    let offers = sqlx::query("SELECT COUNT(*)::BIGINT AS c FROM offers")
        .fetch_one(&pool)
        .await?;
    assert_eq!(offers.get::<i64, _>("c"), 1);

    let pre_lock_utxos = sqlx::query(
        "SELECT COUNT(*)::BIGINT AS c FROM offer_utxos WHERE utxo_type::text = 'pre_lock'",
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(pre_lock_utxos.get::<i64, _>("c"), 1);

    let participants = sqlx::query("SELECT COUNT(*)::BIGINT AS c FROM offer_participants")
        .fetch_one(&pool)
        .await?;
    assert_eq!(participants.get::<i64, _>("c"), 2);

    Ok(())
}

#[tokio::test]
#[serial]
async fn handle_pre_lock_creation_with_malformed_outputs_returns_error() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let mut cache = UtxoCache::new();

    let params = synthesized_pre_lock_parameters();
    let malformed_tx = tx_with_input(
        outpoint_with_txid_byte(0x30, 0),
        vec![normal_output(); 6], // < 7 outputs triggers the guard clause
    );

    let mut sql_tx = pool.begin().await?;
    let error = handle_pre_lock_creation(&mut sql_tx, &mut cache, params, &malformed_tx, 3_000)
        .await
        .expect_err("handler must reject tx with < 7 outputs");
    sql_tx.rollback().await?;

    let message = error.to_string();
    assert!(
        message.contains("Malformed PreLock transaction"),
        "unexpected error message: {message}"
    );

    Ok(())
}

/// Pins: a UTXO created by tx1 must be visible to tx2 via `cache.get`
/// BEFORE `commit_block` is called. We use lending_creation -> repayment
/// within one block instead of pre-lock -> lending because the latter
/// needs the full Simplex contract machinery (see module comment above).
#[tokio::test]
#[serial]
async fn same_block_create_and_spend_routes_through_pending_cache() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let mut cache = UtxoCache::new();

    let offer_id = Uuid::new_v4();
    let pre_lock_outpoint = outpoint_with_txid_byte(0x40, 0);
    seed_offer_with_pre_lock(&pool, offer_id, pre_lock_outpoint, 4_000).await?;
    cache.insert(
        pre_lock_outpoint,
        ActiveUtxo {
            offer_id,
            data: UtxoData::Offer(UtxoType::PreLock),
        },
    );

    let lending_tx = padded_tx_with_inputs(vec![pre_lock_outpoint], vec![normal_output(); 5]);
    let lending_outpoint = OutPoint {
        txid: lending_tx.txid(),
        vout: 0,
    };

    // tx2 must see `lending_outpoint` via the pending-ops map; `commit_block`
    // has not run yet.
    let repayment_tx = tx_with_input(
        lending_outpoint,
        vec![
            normal_output(),
            normal_output(),
            null_data_output(),
            null_data_output(),
            null_data_output(),
        ],
    );
    let repayment_outpoint = OutPoint {
        txid: repayment_tx.txid(),
        vout: 1,
    };

    let mut tx_bytes_by_id = HashMap::new();
    tx_bytes_by_id.insert(
        lending_tx.txid().to_string(),
        encode::serialize(&lending_tx),
    );
    tx_bytes_by_id.insert(
        repayment_tx.txid().to_string(),
        encode::serialize(&repayment_tx),
    );

    let (base_url, server_handle) = start_mock_esplora(MockEsploraState {
        block_hash: "integration-same-block-visibility".to_string(),
        txids: vec![
            lending_tx.txid().to_string(),
            repayment_tx.txid().to_string(),
        ],
        tx_bytes_by_id,
    })
    .await?;
    let client = EsploraClient::with_base_url(&base_url);

    process_block(&pool, &client, &mut cache, 4_001).await?;

    assert_eq!(current_status(&pool, offer_id).await?, "repaid");
    assert!(cache.get(&pre_lock_outpoint).is_none());
    // Created + spent within one block -> net absent from the committed cache.
    assert!(cache.get(&lending_outpoint).is_none());
    assert!(cache.get(&repayment_outpoint).is_some());
    assert_eq!(sync_state_row_count(&pool).await?, 1);

    server_handle.abort();
    Ok(())
}

const LENDER_ASSET_BYTE: u8 = 8;

#[tokio::test]
#[serial]
async fn lender_nft_movement_updates_history() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let mut cache = UtxoCache::new();
    let client = EsploraClient::new();

    let offer_id = Uuid::new_v4();
    // Seeded `lender_nft_asset_id` is `[8; 32]` -> movement tx must emit
    // asset byte 8 for the handler to pick up the new lender NFT output.
    let pre_lock_outpoint = outpoint_with_txid_byte(0x50, 0);
    seed_offer_with_pre_lock(&pool, offer_id, pre_lock_outpoint, 5_000).await?;

    let lender_outpoint = outpoint_with_txid_byte(0x51, 2);
    seed_participant_utxo_row(
        &pool,
        &unspent_participant(
            offer_id,
            ParticipantType::Lender,
            lender_outpoint,
            vec![0x52, 0xac],
            5_001,
        ),
    )
    .await?;
    cache.insert(
        lender_outpoint,
        ActiveUtxo {
            offer_id,
            data: UtxoData::Participant(ParticipantType::Lender),
        },
    );

    let move_tx = tx_with_input(
        lender_outpoint,
        vec![explicit_asset_output(
            LENDER_ASSET_BYTE,
            non_op_return_script(),
        )],
    );
    {
        let mut sql_tx = pool.begin().await?;
        process_tx(&mut sql_tx, &move_tx, &mut cache, &client, 5_002).await?;
        sql_tx.commit().await?;
    }

    let moved_outpoint = OutPoint {
        txid: move_tx.txid(),
        vout: 0,
    };
    assert!(cache.get(&lender_outpoint).is_none());
    assert!(cache.get(&moved_outpoint).is_some());
    assert_eq!(
        count_participants(&pool, offer_id, "lender", Some(false)).await?,
        1
    );
    assert_eq!(
        count_participants(&pool, offer_id, "lender", Some(true)).await?,
        1
    );

    Ok(())
}

#[tokio::test]
#[serial]
async fn load_utxo_cache_excludes_spent_utxos() -> anyhow::Result<()> {
    let pool = test_pool().await?;

    let offer_id = Uuid::new_v4();
    let mut offer = offer_model(offer_id, 6_000, vec![0x42_u8; 32]);
    offer.current_status = OfferStatus::Active;
    seed_offer_row(&pool, &offer).await?;

    let spent_pre_lock_outpoint = outpoint_with_txid_byte(0x60, 0);
    seed_offer_utxo_row(
        &pool,
        &spent_offer_utxo(
            offer_id,
            spent_pre_lock_outpoint,
            UtxoType::PreLock,
            6_000,
            6_001,
            0x61,
        ),
    )
    .await?;

    let spent_borrower_outpoint = outpoint_with_txid_byte(0x62, 1);
    seed_participant_utxo_row(
        &pool,
        &spent_participant(
            offer_id,
            ParticipantType::Borrower,
            spent_borrower_outpoint,
            vec![0x51, 0xac],
            6_000,
            6_002,
            0x63,
        ),
    )
    .await?;

    let unspent_borrower_outpoint = outpoint_with_txid_byte(0x64, 2);
    seed_participant_utxo_row(
        &pool,
        &unspent_participant(
            offer_id,
            ParticipantType::Borrower,
            unspent_borrower_outpoint,
            vec![0x52, 0xac],
            6_003,
        ),
    )
    .await?;

    let cache = load_utxo_cache(&pool).await?;

    // Pins `WHERE spent_txid IS NULL` in `load_utxo_cache`.
    assert!(cache.get(&unspent_borrower_outpoint).is_some());
    assert!(cache.get(&spent_pre_lock_outpoint).is_none());
    assert!(cache.get(&spent_borrower_outpoint).is_none());

    Ok(())
}

#[tokio::test]
#[serial]
async fn process_block_rolls_back_when_first_tx_fails() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let mut cache = UtxoCache::new();

    let valid_offer_id = Uuid::new_v4();
    let valid_prelock_outpoint = outpoint_with_txid_byte(0x70, 0);
    seed_offer_with_pre_lock(&pool, valid_offer_id, valid_prelock_outpoint, 7_000).await?;
    cache.insert(
        valid_prelock_outpoint,
        ActiveUtxo {
            offer_id: valid_offer_id,
            data: UtxoData::Offer(UtxoType::PreLock),
        },
    );

    // Bad tx is FIRST -> if atomicity holds, the subsequent good tx must
    // never touch the DB or the cache. `missing_offer_id` is cached but
    // absent from `offers`, so `get_offer_participant_asset_id` raises
    // `RowNotFound` and aborts the block.
    let missing_offer_id = Uuid::new_v4();
    let missing_participant_outpoint = outpoint_with_txid_byte(0x71, 1);
    cache.insert(
        missing_participant_outpoint,
        ActiveUtxo {
            offer_id: missing_offer_id,
            data: UtxoData::Participant(ParticipantType::Borrower),
        },
    );

    let bad_tx = tx_with_input(missing_participant_outpoint, vec![normal_output()]);
    let good_tx = padded_tx_with_inputs(vec![valid_prelock_outpoint], vec![normal_output(); 5]);

    let mut tx_bytes_by_id = HashMap::new();
    tx_bytes_by_id.insert(bad_tx.txid().to_string(), encode::serialize(&bad_tx));
    tx_bytes_by_id.insert(good_tx.txid().to_string(), encode::serialize(&good_tx));

    let (base_url, server_handle) = start_mock_esplora(MockEsploraState {
        block_hash: "integration-block-bad-first".to_string(),
        txids: vec![bad_tx.txid().to_string(), good_tx.txid().to_string()],
        tx_bytes_by_id,
    })
    .await?;
    let client = EsploraClient::with_base_url(&base_url);

    let result = process_block(&pool, &client, &mut cache, 7_001).await;
    assert!(result.is_err());

    assert_eq!(current_status(&pool, valid_offer_id).await?, "pending");
    // pre_lock stays unspent -> good_tx was never applied.
    assert_eq!(
        count_offer_utxos(&pool, valid_offer_id, "pre_lock", Some(false)).await?,
        1
    );
    assert_eq!(
        count_offer_utxos(&pool, valid_offer_id, "lending", None).await?,
        0
    );
    assert_eq!(sync_state_row_count(&pool).await?, 0);

    assert!(cache.get(&valid_prelock_outpoint).is_some());
    assert!(cache.get(&missing_participant_outpoint).is_some());
    let rolled_back_lending_outpoint = OutPoint {
        txid: good_tx.txid(),
        vout: 0,
    };
    assert!(cache.get(&rolled_back_lending_outpoint).is_none());

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn process_block_empty_txids_still_commits_sync_state() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let mut cache = UtxoCache::new();

    let pre_existing_offer_id = Uuid::new_v4();
    let pre_existing_outpoint = outpoint_with_txid_byte(0x80, 0);
    seed_offer_with_pre_lock(&pool, pre_existing_offer_id, pre_existing_outpoint, 8_000).await?;
    cache.insert(
        pre_existing_outpoint,
        ActiveUtxo {
            offer_id: pre_existing_offer_id,
            data: UtxoData::Offer(UtxoType::PreLock),
        },
    );

    let block_hash = "integration-empty-block".to_string();
    let (base_url, server_handle) = start_mock_esplora(MockEsploraState {
        block_hash: block_hash.clone(),
        txids: vec![],
        tx_bytes_by_id: HashMap::new(),
    })
    .await?;
    let client = EsploraClient::with_base_url(&base_url);

    process_block(&pool, &client, &mut cache, 8_001).await?;

    let sync =
        sqlx::query("SELECT last_indexed_height, last_indexed_hash FROM sync_state WHERE id = 1")
            .fetch_one(&pool)
            .await?;
    assert_eq!(sync.get::<i64, _>("last_indexed_height"), 8_001);
    assert_eq!(sync.get::<String, _>("last_indexed_hash"), block_hash);

    assert_eq!(
        current_status(&pool, pre_existing_offer_id).await?,
        "pending"
    );
    assert!(cache.get(&pre_existing_outpoint).is_some());

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn process_block_propagates_esplora_block_txids_500() -> anyhow::Result<()> {
    async fn block_hash_ok() -> impl IntoResponse {
        "integration-block-hash-txids-500".to_string()
    }
    async fn block_txids_500() -> impl IntoResponse {
        (StatusCode::INTERNAL_SERVER_ERROR, "txids boom")
    }

    let pool = test_pool().await?;
    let mut cache = UtxoCache::new();

    let app = Router::new()
        .route("/block-height/{height}", get(block_hash_ok))
        .route("/block/{hash}/txids", get(block_txids_500));
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let addr = listener.local_addr()?;
    let server_handle = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });

    let client = EsploraClient::with_base_url(&format!("http://{addr}"));
    let result = process_block(&pool, &client, &mut cache, 9_100).await;
    assert!(result.is_err());
    assert_eq!(sync_state_row_count(&pool).await?, 0);

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn process_block_propagates_esplora_tx_raw_500() -> anyhow::Result<()> {
    async fn block_hash_ok() -> impl IntoResponse {
        "integration-block-hash-tx-500".to_string()
    }
    async fn block_txids_ok() -> impl IntoResponse {
        axum::Json(vec![
            "0000000000000000000000000000000000000000000000000000000000000001".to_string(),
        ])
    }
    async fn tx_raw_500() -> impl IntoResponse {
        (StatusCode::INTERNAL_SERVER_ERROR, "tx boom")
    }

    let pool = test_pool().await?;
    let mut cache = UtxoCache::new();

    let app = Router::new()
        .route("/block-height/{height}", get(block_hash_ok))
        .route("/block/{hash}/txids", get(block_txids_ok))
        .route("/tx/{txid}/raw", get(tx_raw_500));
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let addr = listener.local_addr()?;
    let server_handle = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });

    let client = EsploraClient::with_base_url(&format!("http://{addr}"));
    let result = process_block(&pool, &client, &mut cache, 9_200).await;
    assert!(result.is_err());
    assert_eq!(sync_state_row_count(&pool).await?, 0);

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn spent_utxo_does_not_reroute_from_cache() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let mut cache = UtxoCache::new();
    let client = EsploraClient::new();

    let offer_id = Uuid::new_v4();
    let mut offer = offer_model(offer_id, 10_000, vec![0xaa_u8; 32]);
    offer.current_status = OfferStatus::Cancelled;
    seed_offer_row(&pool, &offer).await?;

    let spent_pre_lock_outpoint = outpoint_with_txid_byte(0x90, 0);
    seed_offer_utxo_row(
        &pool,
        &OfferUtxoModel {
            offer_id,
            txid: spent_pre_lock_outpoint.txid.as_byte_array().to_vec(),
            vout: spent_pre_lock_outpoint.vout as i32,
            utxo_type: UtxoType::PreLock,
            created_at_height: 10_000,
            spent_txid: Some(vec![0x91_u8; 32]),
            spent_at_height: Some(10_001),
        },
    )
    .await?;

    // Deliberately do NOT seed the cache: load_utxo_cache would have excluded
    // this spent outpoint. A tx that now spends it must be ignored entirely.
    let stale_spend_tx = tx_with_input(spent_pre_lock_outpoint, vec![normal_output(); 5]);
    {
        let mut sql_tx = pool.begin().await?;
        process_tx(&mut sql_tx, &stale_spend_tx, &mut cache, &client, 10_100).await?;
        sql_tx.commit().await?;
    }

    assert_eq!(current_status(&pool, offer_id).await?, "cancelled");
    assert_eq!(
        count_offer_utxos(&pool, offer_id, "lending", None).await?,
        0
    );
    let post_tx_outpoint = OutPoint {
        txid: stale_spend_tx.txid(),
        vout: 0,
    };
    assert!(cache.get(&post_tx_outpoint).is_none());

    Ok(())
}
