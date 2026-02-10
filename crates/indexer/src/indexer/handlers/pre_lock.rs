use sqlx::PgPool;

use simplicityhl::elements::{Transaction, Txid, hashes::Hash};

use lending_contracts::{
    pre_lock::{build_arguments::PreLockArguments, get_pre_lock_address},
    sdk::{extract_arguments_from_tx, taproot_unspendable_internal_key},
};
use uuid::Uuid;

pub async fn handle_pre_lock_creation(
    db: &PgPool,
    pre_lock_args: PreLockArguments,
    txid: Txid,
    current_height: u64,
) -> anyhow::Result<()> {
    let lending_params = pre_lock_args.lending_params();

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
        &pre_lock_args.borrower_pub_key(),
        &pre_lock_args.collateral_asset_id(),
        &pre_lock_args.principal_asset_id(),
        &pre_lock_args.first_parameters_nft_asset_id(),
        &pre_lock_args.second_parameters_nft_asset_id(),
        &pre_lock_args.borrower_nft_asset_id(),
        &pre_lock_args.lender_nft_asset_id(),
        lending_params.collateral_amount as i64,
        lending_params.principal_amount as i64,
        lending_params.principal_interest_rate as i32,
        lending_params.loan_expiration_time as i32,
        current_height as i64,
        txid.as_byte_array(),
    )
    .execute(db)
    .await?;

    Ok(())
}

pub fn is_pre_lock_creation_tx(tx: &Transaction) -> Option<PreLockArguments> {
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
