use simplex::{provider::ProviderTrait, simplicityhl::elements::Transaction};

use crate::{
    programs::LendingParameters,
    transactions::lending::LendingTransactionError,
    utils::{FirstNFTParameters, LendingOfferParameters, SecondNFTParameters},
};

pub fn extract_lending_parameters_from_tx(
    tx: &Transaction,
    provider: &impl ProviderTrait,
) -> Result<LendingParameters, LendingTransactionError> {
    if tx.input.len() < 7 || tx.output.len() < 7 {
        return Err(LendingTransactionError::NotALendingCreationTx(tx.txid()));
    }

    let collateral_asset_id = tx.output[0]
        .asset
        .explicit()
        .ok_or_else(LendingTransactionError::ConfidentialAssetsAreNotSupported)?;
    let principal_asset_id = tx.output[1]
        .asset
        .explicit()
        .ok_or_else(LendingTransactionError::ConfidentialAssetsAreNotSupported)?;
    let first_parameters_nft_asset_id = tx.output[2]
        .asset
        .explicit()
        .expect("Utility NFT must be explicit");
    let second_parameters_nft_asset_id = tx.output[3]
        .asset
        .explicit()
        .expect("Utility NFT must be explicit");
    let borrower_nft_asset_id = tx.output[4]
        .asset
        .explicit()
        .expect("Utility NFT must be explicit");
    let lender_nft_asset_id = tx.output[5]
        .asset
        .explicit()
        .expect("Utility NFT must be explicit");

    let first_parameters_nft_amount = tx.output[2]
        .value
        .explicit()
        .expect("Parameter NFT must have explicit amount");
    let second_parameters_nft_amount = tx.output[3]
        .value
        .explicit()
        .expect("Parameter NFT must have explicit amount");

    let offer_parameters = LendingOfferParameters::build_from_parameters_nfts(
        &FirstNFTParameters::decode(first_parameters_nft_amount),
        &SecondNFTParameters::decode(second_parameters_nft_amount),
    );

    let lending_parameters = LendingParameters {
        collateral_asset_id,
        principal_asset_id,
        first_parameters_nft_asset_id,
        second_parameters_nft_asset_id,
        borrower_nft_asset_id,
        lender_nft_asset_id,
        offer_parameters,
        network: *provider.get_network(),
    };

    Ok(lending_parameters)
}
