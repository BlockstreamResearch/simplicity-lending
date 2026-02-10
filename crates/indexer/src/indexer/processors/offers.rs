use sqlx::PgPool;

use simplicityhl::elements::{Transaction, hashes::Hash};

use lending_contracts::{
    pre_lock::{build_arguments::PreLockArguments, get_pre_lock_address},
    sdk::{extract_arguments_from_tx, taproot_unspendable_internal_key},
};
use uuid::Uuid;

use crate::{esplora_client::EsploraClient, indexer::UtxoCache};

#[tracing::instrument(
    skip(db, client, _cache),
    fields(block_run_id = %Uuid::new_v4(), height = %block_height)
)]
pub async fn process_block(
    db: &PgPool,
    client: &EsploraClient,
    _cache: &mut UtxoCache,
    block_height: u64,
) -> anyhow::Result<()> {
    let block_hash = client.get_block_hash_at_height(block_height).await?;
    let txids = client.get_block_txids(&block_hash).await?;
    let tx_count = txids.len();

    let mut tx = db.begin().await?;

    for txid in txids {
        let tx = client.get_tx_by_id(txid).await?;

        process_pre_lock_tx(db, &tx, block_height).await?;
    }

    sqlx::query!(
        r#"
        INSERT INTO sync_state (id, last_indexed_height, last_indexed_hash)
        VALUES (1, $1, $2)
        ON CONFLICT (id) DO UPDATE SET
            last_indexed_height = EXCLUDED.last_indexed_height,
            last_indexed_hash = EXCLUDED.last_indexed_hash,
            updated_at = NOW()
        "#,
        block_height as i64,
        block_hash,
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    tracing::info!(
        "Successfully indexed block #{} ({} txs)",
        block_height,
        tx_count
    );

    Ok(())
}

pub async fn process_pre_lock_tx(
    db: &PgPool,
    tx: &Transaction,
    current_height: u64,
) -> anyhow::Result<()> {
    let txid = tx.txid();

    match is_pre_lock_creation_tx(tx) {
        Some(args) => {
            tracing::info!("Found pre lock transaction - {txid}");
            let lending_params = args.lending_params();

            sqlx::query!(
                r#"
                INSERT INTO offers (
                    id, borrower_pub_key, collateral_asset_id, principal_asset_id,
                    first_parameters_nft_asset_id, second_parameters_nft_asset_id,
                    borrower_nft_asset_id, lender_nft_asset_id,
                    collateral_amount, principal_amount, interest_rate,
                    loan_expiration_time, created_at_height, created_at_txid
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                ON CONFLICT (created_at_txid) DO NOTHING
                "#,
                Uuid::new_v4(),
                &args.borrower_pub_key(),
                &args.collateral_asset_id(),
                &args.principal_asset_id(),
                &args.first_parameters_nft_asset_id(),
                &args.second_parameters_nft_asset_id(),
                &args.borrower_nft_asset_id(),
                &args.lender_nft_asset_id(),
                lending_params.collateral_amount as i64,
                lending_params.principal_amount as i64,
                lending_params.principal_interest_rate as i32,
                lending_params.loan_expiration_time as i32,
                current_height as i64,
                txid.as_byte_array(),
            )
            .execute(db)
            .await?;
        }
        None => {
            tracing::info!("Not a pre lock transaction - {txid}");
        }
    }

    Ok(())
}

fn is_pre_lock_creation_tx(tx: &Transaction) -> Option<PreLockArguments> {
    let pre_lock_args =
        extract_arguments_from_tx(tx, simplicityhl_core::SimplicityNetwork::LiquidTestnet).ok()?;

    let expected_pre_lock_address = get_pre_lock_address(
        &taproot_unspendable_internal_key(),
        &pre_lock_args,
        simplicityhl_core::SimplicityNetwork::LiquidTestnet,
    )
    .ok()?;

    if tx.output.first().unwrap().script_pubkey != expected_pre_lock_address.script_pubkey() {
        return None;
    }

    Some(pre_lock_args)
}
