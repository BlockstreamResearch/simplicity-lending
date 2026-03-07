#[path = "support/wallet_abi_common.rs"]
mod wallet_abi_common;
#[path = "support/wallet_abi_lending_support.rs"]
mod wallet_abi_lending_support;

use anyhow::Result;
use wallet_abi_lending_support::LendingScenario;

#[tokio::test]
async fn test_prepare_utility_nfts_issuance_happy_path() -> Result<()> {
    let scenario = LendingScenario::new_default().await?;
    let prepared = scenario.prepare_utility_nfts_issuance().await?;

    assert_eq!(prepared.issuance_utxos.len(), 4);
    for issuance_utxo in &prepared.issuance_utxos {
        assert_eq!(issuance_utxo.value()?, 100);
    }

    Ok(())
}

#[tokio::test]
async fn test_issue_utility_nfts_happy_path() -> Result<()> {
    let scenario = LendingScenario::new_default().await?;
    let prepared = scenario.prepare_utility_nfts_issuance().await?;
    let issued = scenario.issue_utility_nfts(&prepared).await?;
    let (first_amount, second_amount) = scenario.terms.encode_parameters_nft_amounts(0)?;

    let borrower_asset = issued.borrower_nft.asset_id_25()?;
    let lender_asset = issued.lender_nft.asset_id_25()?;
    let first_asset = issued.first_parameters_nft.asset_id_25()?;
    let second_asset = issued.second_parameters_nft.asset_id_25()?;

    assert_ne!(borrower_asset, lender_asset);
    assert_ne!(borrower_asset, first_asset);
    assert_ne!(borrower_asset, second_asset);
    assert_ne!(lender_asset, first_asset);
    assert_ne!(lender_asset, second_asset);
    assert_ne!(first_asset, second_asset);

    assert_eq!(issued.borrower_nft.value()?, 1);
    assert_eq!(issued.lender_nft.value()?, 1);
    assert_eq!(issued.first_parameters_nft.value()?, first_amount);
    assert_eq!(issued.second_parameters_nft.value()?, second_amount);

    Ok(())
}

#[tokio::test]
async fn test_pre_lock_creation_happy_path() -> Result<()> {
    let scenario = LendingScenario::new_default().await?;
    let prepared = scenario.prepare_utility_nfts_issuance().await?;
    let issued = scenario.issue_utility_nfts(&prepared).await?;
    let pre_lock = scenario.create_pre_lock(&issued).await?;

    assert_eq!(pre_lock.pre_lock.value()?, scenario.terms.collateral_amount);
    assert_eq!(pre_lock.borrower_nft.value()?, 1);
    assert_eq!(pre_lock.lender_nft.value()?, 1);

    Ok(())
}

#[tokio::test]
async fn test_pre_lock_cancellation_happy_path() -> Result<()> {
    let scenario = LendingScenario::new_default().await?;
    let prepared = scenario.prepare_utility_nfts_issuance().await?;
    let issued = scenario.issue_utility_nfts(&prepared).await?;
    let pre_lock = scenario.create_pre_lock(&issued).await?;
    let collateral = scenario.cancel_pre_lock(&pre_lock).await?;

    assert_eq!(collateral.asset_id_25()?, scenario.collateral_asset_id);
    assert_eq!(collateral.value()?, scenario.terms.collateral_amount);

    Ok(())
}

#[tokio::test]
async fn test_lending_creation_happy_path() -> Result<()> {
    let scenario = LendingScenario::new_default().await?;
    let prepared = scenario.prepare_utility_nfts_issuance().await?;
    let issued = scenario.issue_utility_nfts(&prepared).await?;
    let pre_lock = scenario.create_pre_lock(&issued).await?;
    let lending = scenario.create_lending(&pre_lock).await?;

    assert_eq!(lending.lending.value()?, scenario.terms.collateral_amount);
    assert_eq!(
        lending.principal_borrowed.asset_id_25()?,
        scenario.principal_asset_id
    );
    assert_eq!(
        lending.principal_borrowed.value()?,
        scenario.terms.principal_amount
    );
    assert_eq!(lending.borrower_nft.value()?, 1);
    assert_eq!(lending.lender_nft.value()?, 1);

    Ok(())
}

#[tokio::test]
async fn test_loan_repayment_and_lender_claim_happy_path() -> Result<()> {
    let scenario = LendingScenario::new_default().await?;
    let prepared = scenario.prepare_utility_nfts_issuance().await?;
    let issued = scenario.issue_utility_nfts(&prepared).await?;
    let pre_lock = scenario.create_pre_lock(&issued).await?;
    let lending = scenario.create_lending(&pre_lock).await?;
    let repayment = scenario.repay_loan(&lending).await?;
    let claim = scenario.claim_repaid_principal(&repayment).await?;

    assert_eq!(
        repayment.collateral.asset_id_25()?,
        scenario.collateral_asset_id
    );
    assert_eq!(
        repayment.collateral.value()?,
        scenario.terms.collateral_amount
    );
    assert_eq!(
        claim.principal_claim.asset_id_25()?,
        scenario.principal_asset_id
    );
    assert_eq!(
        claim.principal_claim.value()?,
        scenario.terms.principal_with_interest()
    );

    Ok(())
}

#[tokio::test]
async fn test_loan_liquidation_happy_path() -> Result<()> {
    let scenario = LendingScenario::new_for_liquidation().await?;
    let prepared = scenario.prepare_utility_nfts_issuance().await?;
    let issued = scenario.issue_utility_nfts(&prepared).await?;
    let pre_lock = scenario.create_pre_lock(&issued).await?;
    let lending = scenario.create_lending(&pre_lock).await?;
    let liquidation = scenario.liquidate_loan(&lending).await?;

    assert_eq!(
        liquidation.collateral.asset_id_25()?,
        scenario.collateral_asset_id
    );
    assert_eq!(
        liquidation.collateral.value()?,
        scenario.terms.collateral_amount
    );

    Ok(())
}
