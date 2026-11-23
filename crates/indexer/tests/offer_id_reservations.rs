mod common;

use common::vault_tracking::seed_minimal_factory;
use common::{offer_model, test_pool};
use lending_indexer::indexer::insert_offer;
use lending_indexer::models::OfferModel;
use serial_test::serial;
use sqlx::PgPool;

async fn insert(pool: &PgPool, offer: &OfferModel) -> anyhow::Result<Option<i64>> {
    let mut sql_tx = pool.begin().await?;
    let id = insert_offer(&mut sql_tx, offer).await?;
    sql_tx.commit().await?;

    Ok(id)
}

/// Removes the offer and reserves its id, as a block rollback does.
async fn remove_with_reservation(pool: &PgPool, offer_id: i64) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO offer_id_reservations (created_at_txid, offer_id)
        SELECT created_at_txid, id FROM offers WHERE id = $1
        "#,
    )
    .bind(offer_id)
    .execute(pool)
    .await?;

    sqlx::query("DELETE FROM offers WHERE id = $1")
        .bind(offer_id)
        .execute(pool)
        .await?;

    Ok(())
}

#[tokio::test]
#[serial]
async fn reinserted_offer_gets_its_reserved_id() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let factory_id = seed_minimal_factory(&pool).await?;
    let first = offer_model(1, factory_id, 100);
    let second = offer_model(2, factory_id, 100);

    insert(&pool, &first).await?.expect("first offer inserted");
    let second_id = insert(&pool, &second)
        .await?
        .expect("second offer inserted");
    remove_with_reservation(&pool, second_id).await?;

    assert_eq!(insert(&pool, &second).await?, Some(second_id));

    Ok(())
}

#[tokio::test]
#[serial]
async fn other_offers_never_take_a_reserved_id() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let factory_id = seed_minimal_factory(&pool).await?;
    let removed = offer_model(1, factory_id, 100);

    let removed_id = insert(&pool, &removed).await?.expect("offer inserted");
    remove_with_reservation(&pool, removed_id).await?;

    let new_id = insert(&pool, &offer_model(2, factory_id, 101))
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
