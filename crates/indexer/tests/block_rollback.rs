mod common;

use std::time::Duration;

use common::db_state::{
    assert_block_rolls_back, assert_rollback_restores, block_hash, block_processor,
    dump_indexer_state, finish_block, index_block,
};
use common::vault_tracking::{
    FIRST_PARTIAL_AMOUNT, SECOND_PARTIAL_AMOUNT, TRACKABLE_REPAYMENT_HEIGHT,
    apply_repayment_to_offer, build_first_partial_repayment_tx, build_full_repayment_tx,
    build_lender_vault_withdraw_all_tx, build_lender_vault_withdraw_on_liquidation_tx,
    build_second_partial_repayment_tx, build_vault_withdraw_part_tx, fetch_active_vault_rows,
    offer_lending_params, seed_minimal_factory, seed_trackable_active_offer, vault_of_type,
};
use common::{
    acceptance_tx, cancellation_tx, explicit_asset_output, factory_model, non_op_return_script,
    offer_model, outpoint_from_offer_id, outpoint_with_txid_byte, seed_participant_utxo_row,
    seed_pending_offer, test_pool, tx_with_input, unique_32_bytes_from_uuid, unspent_offer_utxo,
    unspent_participant,
};
use lending_indexer::events::{INDEXER_EVENTS_CHANNEL, IndexerEvent};
use lending_indexer::indexer::{
    RollbackError, insert_factory, insert_factory_auth_utxo, insert_factory_utxo, insert_offer,
    insert_offer_utxo, insert_participant_utxo, spend_factory_auth_utxo, spend_factory_utxo,
    update_factory_status,
};
use lending_indexer::models::{
    FactoryAuthModel, FactoryStatus, FactoryUtxoModel, OfferModel, ParticipantType, UtxoType,
    VaultType,
};
use serial_test::serial;
use simplex::simplicityhl::elements::{OutPoint, Txid};
use sqlx::{PgPool, postgres::PgListener};
use uuid::Uuid;

/// Parent of the rolled back block; setup transactions are indexed here.
const PARENT: u64 = TRACKABLE_REPAYMENT_HEIGHT;
/// The block that is indexed and rolled back.
const BLOCK: u64 = PARENT + 1;
const SEED_HEIGHT: i64 = 100;

fn factory_utxo(factory_id: Uuid, outpoint: OutPoint, height: u64) -> FactoryUtxoModel {
    FactoryUtxoModel {
        factory_id,
        txid: outpoint.txid.to_byte_array().to_vec(),
        vout: outpoint.vout as i32,
        created_at_height: height as i64,
        spent_txid: None,
        spent_at_height: None,
    }
}

fn factory_auth(factory_id: Uuid, outpoint: OutPoint, height: u64) -> FactoryAuthModel {
    FactoryAuthModel {
        factory_id,
        script_pubkey: vec![0x52],
        txid: outpoint.txid.to_byte_array().to_vec(),
        vout: outpoint.vout as i32,
        created_at_height: height as i64,
        spent_txid: None,
        spent_at_height: None,
    }
}

/// Seeds a factory with an unspent program UTXO and auth UTXO at `txid_byte:0` / `:1`.
async fn seed_factory_with_utxos(pool: &PgPool, txid_byte: u8) -> anyhow::Result<Uuid> {
    let factory_id = seed_minimal_factory(pool).await?;

    let mut sql_tx = pool.begin().await?;
    insert_factory_utxo(
        &mut sql_tx,
        &factory_utxo(
            factory_id,
            outpoint_with_txid_byte(txid_byte, 0),
            SEED_HEIGHT as u64,
        ),
    )
    .await?;
    insert_factory_auth_utxo(
        &mut sql_tx,
        &factory_auth(
            factory_id,
            outpoint_with_txid_byte(txid_byte, 1),
            SEED_HEIGHT as u64,
        ),
    )
    .await?;
    sql_tx.commit().await?;

    Ok(factory_id)
}

#[tokio::test]
#[serial]
async fn offer_acceptance_rolls_back() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let factory_id = seed_minimal_factory(&pool).await?;
    let (_, pending_outpoint) = seed_pending_offer(&pool, factory_id, 1, SEED_HEIGHT).await?;
    let mut processor = block_processor(&pool).await?;
    index_block(&mut processor, PARENT, &[]).await?;

    assert_block_rolls_back(
        &pool,
        &mut processor,
        BLOCK,
        &[acceptance_tx(pending_outpoint)],
    )
    .await
}

#[tokio::test]
#[serial]
async fn offer_cancellation_rolls_back() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let factory_id = seed_minimal_factory(&pool).await?;
    let (_, pending_outpoint) = seed_pending_offer(&pool, factory_id, 1, SEED_HEIGHT).await?;
    let mut processor = block_processor(&pool).await?;
    index_block(&mut processor, PARENT, &[]).await?;

    assert_block_rolls_back(
        &pool,
        &mut processor,
        BLOCK,
        &[cancellation_tx(pending_outpoint)],
    )
    .await
}

#[tokio::test]
#[serial]
async fn participant_nft_move_rolls_back() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let factory_id = seed_minimal_factory(&pool).await?;
    let (offer_id, _) = seed_pending_offer(&pool, factory_id, 1, SEED_HEIGHT).await?;
    let borrower_outpoint = outpoint_with_txid_byte(0x31, 0);
    seed_participant_utxo_row(
        &pool,
        &unspent_participant(
            offer_id,
            ParticipantType::Borrower,
            borrower_outpoint,
            vec![0x51],
            SEED_HEIGHT,
        ),
    )
    .await?;
    let mut processor = block_processor(&pool).await?;
    index_block(&mut processor, PARENT, &[]).await?;

    // The borrower NFT (asset `[7; 32]`) moves to a new owner.
    let transfer = tx_with_input(
        borrower_outpoint,
        vec![explicit_asset_output(7, non_op_return_script())],
    );

    assert_block_rolls_back(&pool, &mut processor, BLOCK, &[transfer]).await
}

#[tokio::test]
#[serial]
async fn first_partial_repayment_rolls_back() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let factory_id = seed_minimal_factory(&pool).await?;
    let (_, active_outpoint, offer) =
        seed_trackable_active_offer(&pool, factory_id, 1, SEED_HEIGHT).await?;
    let mut processor = block_processor(&pool).await?;
    index_block(&mut processor, PARENT, &[]).await?;

    let (repayment, _) =
        build_first_partial_repayment_tx(active_outpoint, &offer, FIRST_PARTIAL_AMOUNT)?;

    assert_block_rolls_back(&pool, &mut processor, BLOCK, &[repayment]).await
}

#[tokio::test]
#[serial]
async fn second_partial_repayment_rolls_back() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let factory_id = seed_minimal_factory(&pool).await?;
    let (_, active_outpoint, mut offer) =
        seed_trackable_active_offer(&pool, factory_id, 1, SEED_HEIGHT).await?;
    let mut processor = block_processor(&pool).await?;

    let (first, debt_after_first) =
        build_first_partial_repayment_tx(active_outpoint, &offer, FIRST_PARTIAL_AMOUNT)?;
    let first_txid = first.txid();
    index_block(&mut processor, PARENT, &[first]).await?;

    apply_repayment_to_offer(&mut offer, FIRST_PARTIAL_AMOUNT)?;
    let second = build_second_partial_repayment_tx(
        OutPoint {
            txid: first_txid,
            vout: 1,
        },
        OutPoint {
            txid: first_txid,
            vout: 2,
        },
        OutPoint {
            txid: first_txid,
            vout: 3,
        },
        &offer,
        debt_after_first,
        SECOND_PARTIAL_AMOUNT,
    )?;

    // The spent vaults and their continuing outputs share the partial unique index on
    // unspent vaults, so this also covers the rollback order.
    assert_block_rolls_back(&pool, &mut processor, BLOCK, &[second]).await
}

#[tokio::test]
#[serial]
async fn full_repayment_rolls_back() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let factory_id = seed_minimal_factory(&pool).await?;
    let (_, active_outpoint, offer) =
        seed_trackable_active_offer(&pool, factory_id, 1, SEED_HEIGHT).await?;
    let mut processor = block_processor(&pool).await?;
    index_block(&mut processor, PARENT, &[]).await?;

    let repayment = build_full_repayment_tx(active_outpoint, &offer)?;

    assert_block_rolls_back(&pool, &mut processor, BLOCK, &[repayment]).await
}

#[tokio::test]
#[serial]
async fn liquidation_rolls_back() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let factory_id = seed_minimal_factory(&pool).await?;
    let (offer_id, active_outpoint, offer) =
        seed_trackable_active_offer(&pool, factory_id, 1, SEED_HEIGHT).await?;
    let mut processor = block_processor(&pool).await?;

    let (repayment, _) =
        build_first_partial_repayment_tx(active_outpoint, &offer, FIRST_PARTIAL_AMOUNT)?;
    let repayment_txid = repayment.txid();
    index_block(&mut processor, PARENT, &[repayment]).await?;

    let vaults = fetch_active_vault_rows(&pool, offer_id).await?;
    let lender_vault = vault_of_type(&vaults, VaultType::Lender);
    let liquidation = build_lender_vault_withdraw_on_liquidation_tx(
        vec![
            OutPoint {
                txid: repayment_txid,
                vout: 1,
            },
            OutPoint {
                txid: repayment_txid,
                vout: lender_vault.vout as u32,
            },
        ],
        &offer,
        lender_vault.amount as u64,
    )?;

    assert_block_rolls_back(&pool, &mut processor, BLOCK, &[liquidation]).await
}

#[tokio::test]
#[serial]
async fn vault_withdraw_part_rolls_back() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let factory_id = seed_minimal_factory(&pool).await?;
    let (offer_id, active_outpoint, offer) =
        seed_trackable_active_offer(&pool, factory_id, 1, SEED_HEIGHT).await?;
    let mut processor = block_processor(&pool).await?;

    let (repayment, _) =
        build_first_partial_repayment_tx(active_outpoint, &offer, FIRST_PARTIAL_AMOUNT)?;
    let repayment_txid = repayment.txid();
    index_block(&mut processor, PARENT, &[repayment]).await?;

    let vaults = fetch_active_vault_rows(&pool, offer_id).await?;
    let lender_vault = vault_of_type(&vaults, VaultType::Lender);
    let withdrawal = build_vault_withdraw_part_tx(
        OutPoint {
            txid: repayment_txid,
            vout: lender_vault.vout as u32,
        },
        &offer,
        VaultType::Lender,
        lender_vault.already_supplied as u64,
        lender_vault.amount as u64,
        lender_vault.amount as u64 / 2,
    )?;

    assert_block_rolls_back(&pool, &mut processor, BLOCK, &[withdrawal]).await
}

fn lender_claim_tx(
    repayment_txid: Txid,
    offer: &OfferModel,
) -> anyhow::Result<simplex::simplicityhl::elements::Transaction> {
    let params = offer_lending_params(offer)?;
    let lender_amount = params.offer_parameters.get_total_amount_to_repay()
        - params.offer_parameters.get_total_protocol_fee();

    build_lender_vault_withdraw_all_tx(
        OutPoint {
            txid: repayment_txid,
            vout: 1,
        },
        offer,
        lender_amount,
    )
}

#[tokio::test]
#[serial]
async fn lender_claim_rolls_back() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let factory_id = seed_minimal_factory(&pool).await?;
    let (_, active_outpoint, offer) =
        seed_trackable_active_offer(&pool, factory_id, 1, SEED_HEIGHT).await?;
    let mut processor = block_processor(&pool).await?;

    let repayment = build_full_repayment_tx(active_outpoint, &offer)?;
    let claim = lender_claim_tx(repayment.txid(), &offer)?;
    index_block(&mut processor, PARENT, &[repayment]).await?;

    assert_block_rolls_back(&pool, &mut processor, BLOCK, &[claim]).await
}

#[tokio::test]
#[serial]
async fn repayment_and_claim_in_one_block_roll_back() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let factory_id = seed_minimal_factory(&pool).await?;
    let (_, active_outpoint, offer) =
        seed_trackable_active_offer(&pool, factory_id, 1, SEED_HEIGHT).await?;
    let mut processor = block_processor(&pool).await?;
    index_block(&mut processor, PARENT, &[]).await?;

    // The offer changes status twice and the lender vault is created and spent in the block.
    let repayment = build_full_repayment_tx(active_outpoint, &offer)?;
    let claim = lender_claim_tx(repayment.txid(), &offer)?;

    assert_block_rolls_back(&pool, &mut processor, BLOCK, &[repayment, claim]).await
}

#[tokio::test]
#[serial]
async fn factory_utxo_moves_and_removal_roll_back() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let moved_factory = seed_factory_with_utxos(&pool, 0x41).await?;
    let removed_factory = seed_factory_with_utxos(&pool, 0x42).await?;
    let mut processor = block_processor(&pool).await?;
    index_block(&mut processor, PARENT, &[]).await?;
    let before = dump_indexer_state(&pool).await?;

    let issuance_txid = Txid::from_byte_array([0x43; 32]);
    let removal_txid = Txid::from_byte_array([0x44; 32]);
    let mut sql_tx = pool.begin().await?;

    // Asset issuance moves the program and auth UTXOs; the new program UTXO shares the
    // partial unique index on unspent factory UTXOs with the spent one.
    spend_factory_utxo(
        &mut sql_tx,
        &outpoint_with_txid_byte(0x41, 0),
        BLOCK,
        issuance_txid,
    )
    .await?;
    insert_factory_utxo(
        &mut sql_tx,
        &factory_utxo(moved_factory, OutPoint::new(issuance_txid, 0), BLOCK),
    )
    .await?;
    spend_factory_auth_utxo(
        &mut sql_tx,
        &outpoint_with_txid_byte(0x41, 1),
        BLOCK,
        issuance_txid,
    )
    .await?;
    insert_factory_auth_utxo(
        &mut sql_tx,
        &factory_auth(moved_factory, OutPoint::new(issuance_txid, 1), BLOCK),
    )
    .await?;

    spend_factory_utxo(
        &mut sql_tx,
        &outpoint_with_txid_byte(0x42, 0),
        BLOCK,
        removal_txid,
    )
    .await?;
    update_factory_status(&mut sql_tx, removed_factory, FactoryStatus::Removed, BLOCK).await?;

    finish_block(&mut sql_tx, BLOCK).await?;
    sql_tx.commit().await?;

    assert_rollback_restores(&pool, &mut processor, BLOCK, &before).await
}

#[tokio::test]
#[serial]
async fn entities_created_in_the_block_are_removed() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let mut processor = block_processor(&pool).await?;
    index_block(&mut processor, PARENT, &[]).await?;
    let before = dump_indexer_state(&pool).await?;

    let creation_txid = Txid::from_byte_array([0x51; 32]);
    let factory_id = Uuid::new_v4();
    let mut offer = offer_model(1, factory_id, BLOCK as i64);
    let mut sql_tx = pool.begin().await?;

    insert_factory(
        &mut sql_tx,
        &factory_model(
            factory_id,
            BLOCK as i64,
            unique_32_bytes_from_uuid(factory_id),
        ),
    )
    .await?;
    insert_factory_utxo(
        &mut sql_tx,
        &factory_utxo(factory_id, OutPoint::new(creation_txid, 0), BLOCK),
    )
    .await?;
    insert_factory_auth_utxo(
        &mut sql_tx,
        &factory_auth(factory_id, OutPoint::new(creation_txid, 1), BLOCK),
    )
    .await?;
    offer.id = insert_offer(&mut sql_tx, &offer)
        .await?
        .expect("offer inserted");
    insert_offer_utxo(
        &mut sql_tx,
        &unspent_offer_utxo(
            offer.id,
            outpoint_from_offer_id(1, 0),
            UtxoType::PendingOffer,
            BLOCK as i64,
        ),
    )
    .await?;
    insert_participant_utxo(
        &mut sql_tx,
        &unspent_participant(
            offer.id,
            ParticipantType::Borrower,
            outpoint_from_offer_id(1, 1),
            vec![0x51],
            BLOCK as i64,
        ),
    )
    .await?;
    finish_block(&mut sql_tx, BLOCK).await?;
    sql_tx.commit().await?;

    assert_rollback_restores(&pool, &mut processor, BLOCK, &before).await?;

    let reservations: Vec<(Vec<u8>, i64)> =
        sqlx::query_as("SELECT created_at_txid, offer_id FROM offer_id_reservations")
            .fetch_all(&pool)
            .await?;
    assert_eq!(reservations, vec![(offer.created_at_txid, offer.id)]);

    Ok(())
}

#[tokio::test]
#[serial]
async fn rollback_makes_the_parent_the_last_block_and_notifies() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let mut processor = block_processor(&pool).await?;
    index_block(&mut processor, PARENT, &[]).await?;
    index_block(&mut processor, BLOCK, &[]).await?;

    let mut listener = PgListener::connect_with(&pool).await?;
    listener.listen(INDEXER_EVENTS_CHANNEL).await?;

    assert_eq!(processor.rollback_block(BLOCK).await?, block_hash(PARENT));

    let (height, hash): (i64, String) = sqlx::query_as(
        "SELECT last_indexed_height, last_indexed_hash FROM sync_state WHERE id = 1",
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!((height as u64, hash), (PARENT, block_hash(PARENT)));

    let notification = tokio::time::timeout(Duration::from_secs(5), listener.recv()).await??;
    let event: IndexerEvent = serde_json::from_str(notification.payload())?;
    assert_eq!(
        event,
        IndexerEvent::BlockReverted {
            height: BLOCK,
            hash: block_hash(BLOCK),
        }
    );

    Ok(())
}

#[tokio::test]
#[serial]
async fn rollback_refuses_a_block_that_is_not_the_last() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let mut processor = block_processor(&pool).await?;
    index_block(&mut processor, PARENT, &[]).await?;
    index_block(&mut processor, BLOCK, &[]).await?;
    let before = dump_indexer_state(&pool).await?;

    let result = processor.rollback_block(PARENT).await;

    assert!(matches!(
        result,
        Err(RollbackError::NotLastBlock {
            height: PARENT,
            last: Some(BLOCK)
        })
    ));
    assert_eq!(dump_indexer_state(&pool).await?, before);

    Ok(())
}

#[tokio::test]
#[serial]
async fn rollback_refuses_without_history() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let mut processor = block_processor(&pool).await?;

    let result = processor.rollback_block(BLOCK).await;

    assert!(matches!(
        result,
        Err(RollbackError::NotLastBlock {
            height: BLOCK,
            last: None
        })
    ));

    Ok(())
}

#[tokio::test]
#[serial]
async fn rollback_refuses_a_block_without_undo_data() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let mut processor = block_processor(&pool).await?;
    sqlx::query(
        "INSERT INTO indexed_blocks (height, hash, revertible) VALUES ($1, 'a', true), ($2, 'b', false)",
    )
    .bind(PARENT as i64)
    .bind(BLOCK as i64)
    .execute(&pool)
    .await?;
    let before = dump_indexer_state(&pool).await?;

    let result = processor.rollback_block(BLOCK).await;

    assert!(matches!(
        result,
        Err(RollbackError::NotRevertible { height: BLOCK })
    ));
    assert_eq!(dump_indexer_state(&pool).await?, before);

    Ok(())
}

#[tokio::test]
#[serial]
async fn rollback_refuses_a_block_without_parent() -> anyhow::Result<()> {
    let pool = test_pool().await?;
    let mut processor = block_processor(&pool).await?;
    index_block(&mut processor, BLOCK, &[]).await?;
    let before = dump_indexer_state(&pool).await?;

    let result = processor.rollback_block(BLOCK).await;

    assert!(matches!(
        result,
        Err(RollbackError::MissingParent { height: BLOCK })
    ));
    assert_eq!(dump_indexer_state(&pool).await?, before);

    Ok(())
}
