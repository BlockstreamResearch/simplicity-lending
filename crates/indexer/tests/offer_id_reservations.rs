mod common;

use common::db_state::{block_processor, finish_block, index_block};
use common::vault_tracking::seed_minimal_factory;
use common::{offer_model, test_pool};
use lending_indexer::indexer::insert_offer;
use lending_indexer::models::OfferModel;
use serial_test::serial;
use sqlx::PgPool;

const PARENT: u64 = 100;
/// The block whose offer is rolled back.
const BLOCK: u64 = PARENT + 1;

async fn insert(pool: &PgPool, offer: &OfferModel) -> anyhow::Result<Option<i64>> {
    let mut sql_tx = pool.begin().await?;
    let id = insert_offer(&mut sql_tx, offer).await?;
    sql_tx.commit().await?;

    Ok(id)
}

/// Creates `offer` in [`BLOCK`] and rolls the block back, which removes the offer and
/// reserves its id. Returns that id.
async fn create_and_roll_back(pool: &PgPool, offer: &OfferModel) -> anyhow::Result<i64> {
    let mut processor = block_processor(pool).await?;
    index_block(&mut processor, PARENT, &[]).await?;

    let mut sql_tx = pool.begin().await?;
    let offer_id = insert_offer(&mut sql_tx, offer)
        .await?
        .expect("offer inserted");
    finish_block(&mut sql_tx, BLOCK).await?;
    sql_tx.commit().await?;

    processor.rollback_block(BLOCK).await?;

    Ok(offer_id)
}

#[tokio::test]
#[serial]
async fn reinserted_offer_gets_its_reserved_id() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let factory_id = seed_minimal_factory(&pool).await?;
    let first = offer_model(1, factory_id, PARENT as i64);
    let second = offer_model(2, factory_id, BLOCK as i64);

    insert(&pool, &first).await?.expect("first offer inserted");
    let second_id = create_and_roll_back(&pool, &second).await?;

    assert_eq!(insert(&pool, &second).await?, Some(second_id));

    Ok(())
}

#[tokio::test]
#[serial]
async fn other_offers_never_take_a_reserved_id() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let factory_id = seed_minimal_factory(&pool).await?;
    let removed = offer_model(1, factory_id, BLOCK as i64);

    let removed_id = create_and_roll_back(&pool, &removed).await?;

    let new_id = insert(&pool, &offer_model(2, factory_id, BLOCK as i64))
        .await?
        .expect("new offer inserted");
    assert_ne!(new_id, removed_id);

    assert_eq!(insert(&pool, &removed).await?, Some(removed_id));

    Ok(())
}

#[tokio::test]
#[serial]
async fn already_indexed_offer_is_still_skipped() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let factory_id = seed_minimal_factory(&pool).await?;
    let offer = offer_model(1, factory_id, 100);

    insert(&pool, &offer).await?.expect("offer inserted");

    assert_eq!(insert(&pool, &offer).await?, None);

    Ok(())
}
