#[path = "support/wallet_abi_common.rs"]
mod wallet_abi_common;
#[path = "support/wallet_abi_script_auth_support.rs"]
mod wallet_abi_script_auth_support;

use anyhow::Result;
use lending_contracts::script_auth::build_arguments::ScriptAuthArguments;
use lwk_simplicity::wallet_abi::test_utils::{RuntimeFundingAsset, fund_address, mine_blocks};
use simplicityhl_core::hash_script;
use wallet_abi_common::WalletAbiHarness;

#[tokio::test]
async fn test_script_auth_creation_happy_path() -> Result<()> {
    let harness = WalletAbiHarness::new().await?;
    let _ = fund_address(&harness.signer_address, RuntimeFundingAsset::Lbtc, 200_000)?;
    let lock_funding = fund_address(
        &harness.signer_address,
        RuntimeFundingAsset::IssuedAsset,
        5_000,
    )?;
    mine_blocks(1)?;
    let state = harness
        .create_script_auth(
            lock_funding.funded_asset_id,
            lock_funding.funded_amount_sat,
            ScriptAuthArguments::new(hash_script(harness.wallet_script_25())),
        )
        .await?;

    assert_eq!(state.locked.asset_id_26()?, lock_funding.funded_asset_id);
    assert_eq!(state.locked.value()?, lock_funding.funded_amount_sat);

    Ok(())
}

#[tokio::test]
async fn test_script_auth_unlock_happy_path() -> Result<()> {
    let harness = WalletAbiHarness::new().await?;
    let _ = fund_address(&harness.signer_address, RuntimeFundingAsset::Lbtc, 200_000)?;
    let lock_funding = fund_address(
        &harness.signer_address,
        RuntimeFundingAsset::IssuedAsset,
        5_000,
    )?;
    mine_blocks(1)?;
    let state = harness
        .create_script_auth(
            lock_funding.funded_asset_id,
            lock_funding.funded_amount_sat,
            ScriptAuthArguments::new(hash_script(harness.wallet_script_25())),
        )
        .await?;
    let auth_funding = fund_address(
        &harness.signer_address,
        RuntimeFundingAsset::IssuedAsset,
        3_000,
    )?;
    mine_blocks(1)?;
    let unlocked = harness
        .unlock_script_auth(
            &state,
            auth_funding.funded_asset_id,
            auth_funding.funded_amount_sat,
        )
        .await?;

    assert_eq!(
        unlocked.unlocked_asset.asset_id_26()?,
        lock_funding.funded_asset_id
    );
    assert_eq!(
        unlocked.unlocked_asset.value()?,
        lock_funding.funded_amount_sat
    );
    assert_eq!(
        unlocked.auth_output.asset_id_26()?,
        auth_funding.funded_asset_id
    );
    assert_eq!(
        unlocked.auth_output.value()?,
        auth_funding.funded_amount_sat
    );

    Ok(())
}
