#[path = "support/wallet_abi_asset_auth_support.rs"]
mod wallet_abi_asset_auth_support;
#[path = "support/wallet_abi_common.rs"]
mod wallet_abi_common;

use anyhow::Result;
use lending_contracts::asset_auth::build_arguments::AssetAuthArguments;
use lwk_simplicity::wallet_abi::test_utils::{RuntimeFundingAsset, fund_address, mine_blocks};
use wallet_abi_common::WalletAbiHarness;

#[tokio::test]
async fn test_asset_auth_creation_happy_path() -> Result<()> {
    let harness = WalletAbiHarness::new().await?;

    let _ = fund_address(&harness.signer_address, RuntimeFundingAsset::Lbtc, 10000000)?;
    let auth_funding_op = fund_address(
        &harness.signer_address,
        RuntimeFundingAsset::IssuedAsset,
        1000,
    )?;

    mine_blocks(1)?;

    let _ = harness
        .create_asset_auth(
            &auth_funding_op.funded_asset_id,
            auth_funding_op.funded_amount_sat,
            AssetAuthArguments::new(
                auth_funding_op.funded_asset_id.into_inner().0,
                auth_funding_op.funded_amount_sat,
                false,
            ),
        )
        .await?;

    Ok(())
}

#[tokio::test]
async fn test_asset_auth_unlock_with_burn_happy_path() -> Result<()> {
    let harness = WalletAbiHarness::new().await?;

    let _ = fund_address(&harness.signer_address, RuntimeFundingAsset::Lbtc, 10000000)?;
    let auth_funding_op = fund_address(
        &harness.signer_address,
        RuntimeFundingAsset::IssuedAsset,
        1000,
    )?;

    mine_blocks(1)?;

    let mut auth_state = harness
        .create_asset_auth(
            &auth_funding_op.funded_asset_id,
            auth_funding_op.funded_amount_sat,
            AssetAuthArguments::new(
                auth_funding_op.funded_asset_id.into_inner().0,
                auth_funding_op.funded_amount_sat,
                true,
            ),
        )
        .await?;
    let () = harness.unlock_asset_auth(&mut auth_state).await?;

    Ok(())
}

#[tokio::test]
async fn test_asset_auth_unlock_without_burn_happy_path() -> Result<()> {
    let harness = WalletAbiHarness::new().await?;

    let _ = fund_address(&harness.signer_address, RuntimeFundingAsset::Lbtc, 10000000)?;
    let auth_funding_op = fund_address(
        &harness.signer_address,
        RuntimeFundingAsset::IssuedAsset,
        1000,
    )?;

    mine_blocks(1)?;

    let mut auth_state = harness
        .create_asset_auth(
            &auth_funding_op.funded_asset_id,
            auth_funding_op.funded_amount_sat,
            AssetAuthArguments::new(
                auth_funding_op.funded_asset_id.into_inner().0,
                auth_funding_op.funded_amount_sat,
                false,
            ),
        )
        .await?;
    let () = harness.unlock_asset_auth(&mut auth_state).await?;

    Ok(())
}
