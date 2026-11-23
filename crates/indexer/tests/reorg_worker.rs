mod common;

use common::chain::FakeChain;
use common::db_state::{dump_chain_state, dump_indexer_state};
use common::vault_tracking::{
    FIRST_PARTIAL_AMOUNT, build_first_partial_repayment_tx, fetch_offer_status,
    seed_trackable_active_offer,
};
use common::{
    acceptance_tx, cancellation_tx, explicit_asset_output, factory_model, non_op_return_script,
    normal_output, outpoint_with_txid_byte, seed_factory_row, seed_pending_offer, test_pool,
    tx_with_input,
};
use lending_indexer::configuration::IndexerSettings;
use lending_indexer::indexer::{
    ChainSource, REORG_HISTORY_DEPTH, StepOutcome, Worker, get_last_indexed_block,
};
use lending_indexer::models::{OfferStatus, UtxoType};
use serial_test::serial;
use simplex::provider::SimplicityNetwork;
use simplex::simplicityhl::elements::{AssetId, OutPoint, Transaction};
use sqlx::PgPool;
use uuid::Uuid;

/// The block the indexer starts after.
const BASE: u64 = 200;
const SEED_HEIGHT: i64 = 100;
const FACTORY_ID: Uuid = Uuid::from_u128(0x5eed);

struct Seeded {
    pending_offer_id: i64,
    pending_outpoint: OutPoint,
    first_partial: Transaction,
}

/// Seeds a pending offer and an active offer with deterministic ids, so two runs over a
/// truncated DB produce the same rows.
async fn seed(pool: &PgPool) -> anyhow::Result<Seeded> {
    seed_factory_row(
        pool,
        &factory_model(FACTORY_ID, SEED_HEIGHT, FACTORY_ID.as_bytes().repeat(2)),
    )
    .await?;
    let (pending_offer_id, pending_outpoint) =
        seed_pending_offer(pool, FACTORY_ID, 1, SEED_HEIGHT).await?;
    let (_, active_outpoint, active_offer) =
        seed_trackable_active_offer(pool, FACTORY_ID, 2, SEED_HEIGHT).await?;
    let (first_partial, _) =
        build_first_partial_repayment_tx(active_outpoint, &active_offer, FIRST_PARTIAL_AMOUNT)?;

    Ok(Seeded {
        pending_offer_id,
        pending_outpoint,
        first_partial,
    })
}

/// Another acceptance of the same offer, e.g. by a different lender.
fn competing_acceptance(pending_outpoint: OutPoint) -> Transaction {
    tx_with_input(
        pending_outpoint,
        vec![
            normal_output(),
            explicit_asset_output(9, non_op_return_script()),
        ],
    )
}

/// A transaction no tracker cares about; makes otherwise empty blocks distinct.
fn noise(seed: u32) -> Transaction {
    tx_with_input(outpoint_with_txid_byte(0xee, seed), vec![normal_output()])
}

async fn start_worker(pool: &PgPool, chain: &FakeChain) -> anyhow::Result<Worker<FakeChain>> {
    Worker::new(
        IndexerSettings {
            protocol_fee_keeper_asset_id: AssetId::from_byte_array([5; 32]),
            interval: 1,
            last_indexed_height: BASE,
            asset_registry: Default::default(),
        },
        pool.clone(),
        chain.clone(),
        SimplicityNetwork::LiquidTestnet,
    )
    .await
}

/// Steps until the worker is up to date and returns the indexed and rolled back heights.
async fn sync(worker: &mut Worker<FakeChain>) -> anyhow::Result<Vec<StepOutcome>> {
    let mut outcomes = Vec::new();

    for _ in 0..100 {
        match worker.step().await? {
            StepOutcome::UpToDate => return Ok(outcomes),
            outcome => outcomes.push(outcome),
        }
    }

    anyhow::bail!("worker did not catch up: {outcomes:?}")
}

async fn active_offer_utxo_txid(pool: &PgPool, offer_id: i64) -> anyhow::Result<Vec<u8>> {
    Ok(sqlx::query_scalar(
        "SELECT txid FROM offer_utxos WHERE offer_id = $1 AND utxo_type = $2 AND spent_txid IS NULL",
    )
    .bind(offer_id)
    .bind(UtxoType::ActiveOffer)
    .fetch_one(pool)
    .await?)
}

#[tokio::test]
#[serial]
async fn block_replaced_at_the_tip_height_is_rolled_back_and_reindexed() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let seeded = seed(&pool).await?;
    let chain = FakeChain::new(BASE);
    chain.push(vec![acceptance_tx(seeded.pending_outpoint)]);
    let mut worker = start_worker(&pool, &chain).await?;

    assert_eq!(
        sync(&mut worker).await?,
        vec![StepOutcome::Indexed(BASE + 1)]
    );
    assert_eq!(
        fetch_offer_status(&pool, seeded.pending_offer_id).await?,
        OfferStatus::Active
    );

    // No new block: the replacement is only visible through the hash at the same height.
    chain.reorg(1, vec![vec![cancellation_tx(seeded.pending_outpoint)]]);

    assert_eq!(
        sync(&mut worker).await?,
        vec![
            StepOutcome::RolledBack(BASE + 1),
            StepOutcome::Indexed(BASE + 1)
        ]
    );
    assert_eq!(
        fetch_offer_status(&pool, seeded.pending_offer_id).await?,
        OfferStatus::Cancelled
    );

    Ok(())
}

#[tokio::test]
#[serial]
async fn replaced_starting_block_is_recorded_again() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let seeded = seed(&pool).await?;
    // The starting block is the chain tip, so it can be replaced.
    let chain = FakeChain::new(BASE - 1);
    chain.push(vec![noise(0)]);
    let mut worker = start_worker(&pool, &chain).await?;
    assert_eq!(sync(&mut worker).await?, vec![]);

    chain.reorg(1, vec![vec![noise(1)]]);

    assert_eq!(
        sync(&mut worker).await?,
        vec![StepOutcome::RolledBack(BASE)]
    );
    assert_eq!(
        get_last_indexed_block(&pool).await?.map(|block| block.hash),
        Some(chain.block_hash_at(BASE).await?)
    );

    chain.push(vec![acceptance_tx(seeded.pending_outpoint)]);

    assert_eq!(
        sync(&mut worker).await?,
        vec![StepOutcome::Indexed(BASE + 1)]
    );

    Ok(())
}

#[tokio::test]
#[serial]
async fn new_block_on_another_parent_rolls_back_and_dropped_tx_is_indexed_later()
-> anyhow::Result<()> {
    let pool = test_pool().await?;
    let seeded = seed(&pool).await?;
    let chain = FakeChain::new(BASE);
    chain.push(vec![acceptance_tx(seeded.pending_outpoint)]);
    let mut worker = start_worker(&pool, &chain).await?;
    sync(&mut worker).await?;

    // The acceptance leaves the chain, which grows past the replaced block.
    chain.reorg(1, vec![vec![noise(1)], vec![noise(2)]]);

    assert_eq!(
        sync(&mut worker).await?,
        vec![
            StepOutcome::RolledBack(BASE + 1),
            StepOutcome::Indexed(BASE + 1),
            StepOutcome::Indexed(BASE + 2)
        ]
    );
    assert_eq!(
        fetch_offer_status(&pool, seeded.pending_offer_id).await?,
        OfferStatus::Pending
    );

    // The same acceptance is mined again in a later block.
    chain.push(vec![acceptance_tx(seeded.pending_outpoint)]);
    sync(&mut worker).await?;

    assert_eq!(
        fetch_offer_status(&pool, seeded.pending_offer_id).await?,
        OfferStatus::Active
    );

    Ok(())
}

#[tokio::test]
#[serial]
async fn competing_tx_in_the_replacement_block_wins() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let seeded = seed(&pool).await?;
    let chain = FakeChain::new(BASE);
    chain.push(vec![acceptance_tx(seeded.pending_outpoint)]);
    let mut worker = start_worker(&pool, &chain).await?;
    sync(&mut worker).await?;

    let competing = competing_acceptance(seeded.pending_outpoint);
    chain.reorg(1, vec![vec![competing.clone()]]);
    sync(&mut worker).await?;

    assert_eq!(
        active_offer_utxo_txid(&pool, seeded.pending_offer_id).await?,
        competing.txid().to_byte_array().to_vec()
    );

    Ok(())
}

#[tokio::test]
#[serial]
async fn two_block_reorg_rolls_back_both_blocks() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let seeded = seed(&pool).await?;
    let chain = FakeChain::new(BASE);
    chain.push(vec![acceptance_tx(seeded.pending_outpoint)]);
    chain.push(vec![seeded.first_partial.clone()]);
    let mut worker = start_worker(&pool, &chain).await?;
    sync(&mut worker).await?;

    chain.reorg(2, vec![vec![noise(1)], vec![noise(2)], vec![noise(3)]]);

    assert_eq!(
        sync(&mut worker).await?,
        vec![
            StepOutcome::RolledBack(BASE + 2),
            StepOutcome::RolledBack(BASE + 1),
            StepOutcome::Indexed(BASE + 1),
            StepOutcome::Indexed(BASE + 2),
            StepOutcome::Indexed(BASE + 3)
        ]
    );
    assert_eq!(
        fetch_offer_status(&pool, seeded.pending_offer_id).await?,
        OfferStatus::Pending
    );
    let repayments: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM offer_repayments")
        .fetch_one(&pool)
        .await?;
    assert_eq!(repayments, 0);

    Ok(())
}

#[tokio::test]
#[serial]
async fn reorg_deeper_than_the_history_stops_indexing() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    seed(&pool).await?;
    let chain = FakeChain::new(BASE);
    let depth = REORG_HISTORY_DEPTH as u32;
    for seed in 0..=depth {
        chain.push(vec![noise(seed)]);
    }
    let mut worker = start_worker(&pool, &chain).await?;
    sync(&mut worker).await?;

    // Every block the history still has a parent for can be rolled back; the oldest cannot.
    chain.reorg(
        depth as usize,
        (0..depth).map(|seed| vec![noise(100 + seed)]).collect(),
    );

    let mut rolled_back = 0;
    let error = loop {
        match worker.step().await {
            Ok(StepOutcome::RolledBack(_)) => rolled_back += 1,
            Ok(outcome) => panic!("unexpected {outcome:?}"),
            Err(error) => break error,
        }
    };
    assert_eq!(rolled_back, depth - 1);
    assert!(
        error
            .to_string()
            .contains("not in the indexed block history"),
        "{error:#}"
    );

    let stuck = dump_indexer_state(&pool).await?;
    assert!(worker.step().await.is_err());
    assert_eq!(dump_indexer_state(&pool).await?, stuck);

    Ok(())
}

#[tokio::test]
#[serial]
async fn lagging_tip_changes_nothing() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let seeded = seed(&pool).await?;
    let chain = FakeChain::new(BASE);
    chain.push(vec![acceptance_tx(seeded.pending_outpoint)]);
    let mut worker = start_worker(&pool, &chain).await?;
    sync(&mut worker).await?;
    let indexed = dump_indexer_state(&pool).await?;

    chain.report_tip(Some(BASE));

    assert_eq!(worker.step().await?, StepOutcome::Waiting);
    assert_eq!(dump_indexer_state(&pool).await?, indexed);

    Ok(())
}

#[tokio::test]
#[serial]
async fn restarted_worker_detects_a_reorg_that_happened_while_it_was_down() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let seeded = seed(&pool).await?;
    let chain = FakeChain::new(BASE);
    chain.push(vec![acceptance_tx(seeded.pending_outpoint)]);
    let mut worker = start_worker(&pool, &chain).await?;
    sync(&mut worker).await?;
    drop(worker);

    chain.reorg(1, vec![vec![cancellation_tx(seeded.pending_outpoint)]]);
    let mut worker = start_worker(&pool, &chain).await?;

    assert_eq!(
        sync(&mut worker).await?,
        vec![
            StepOutcome::RolledBack(BASE + 1),
            StepOutcome::Indexed(BASE + 1)
        ]
    );
    assert_eq!(
        fetch_offer_status(&pool, seeded.pending_offer_id).await?,
        OfferStatus::Cancelled
    );

    Ok(())
}

#[tokio::test]
#[serial]
async fn restart_between_rollback_and_reindex_resumes_from_the_parent() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let seeded = seed(&pool).await?;
    let chain = FakeChain::new(BASE);
    chain.push(vec![acceptance_tx(seeded.pending_outpoint)]);
    let mut worker = start_worker(&pool, &chain).await?;
    sync(&mut worker).await?;

    chain.reorg(1, vec![vec![cancellation_tx(seeded.pending_outpoint)]]);
    assert_eq!(worker.step().await?, StepOutcome::RolledBack(BASE + 1));
    drop(worker);

    let mut worker = start_worker(&pool, &chain).await?;
    assert_eq!(worker.last_indexed_height(), BASE);

    assert_eq!(
        sync(&mut worker).await?,
        vec![StepOutcome::Indexed(BASE + 1)]
    );
    assert_eq!(
        fetch_offer_status(&pool, seeded.pending_offer_id).await?,
        OfferStatus::Cancelled
    );

    Ok(())
}

#[tokio::test]
#[serial]
async fn state_after_a_reorg_equals_indexing_the_new_chain_from_scratch() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let seeded = seed(&pool).await?;
    let chain = FakeChain::new(BASE);
    chain.push(vec![noise(0)]);
    chain.push(vec![
        acceptance_tx(seeded.pending_outpoint),
        seeded.first_partial.clone(),
    ]);
    let mut worker = start_worker(&pool, &chain).await?;
    sync(&mut worker).await?;

    // The acceptance is replaced by a cancellation and the repayment moves one block later.
    let new_blocks = vec![
        vec![cancellation_tx(seeded.pending_outpoint)],
        vec![seeded.first_partial.clone()],
    ];
    chain.reorg(1, new_blocks.clone());
    sync(&mut worker).await?;
    let after_reorg = dump_chain_state(&pool).await?;
    drop(worker);

    let pool = test_pool().await?;
    seed(&pool).await?;
    let fresh_chain = FakeChain::new(BASE);
    fresh_chain.push(vec![noise(0)]);
    for txs in new_blocks {
        fresh_chain.push(txs);
    }
    let mut worker = start_worker(&pool, &fresh_chain).await?;
    sync(&mut worker).await?;

    assert_eq!(dump_chain_state(&pool).await?, after_reorg);

    Ok(())
}
