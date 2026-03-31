use simplex::simplicityhl::elements::{AssetId, Script};
use simplex::{
    provider::SimplicityNetwork,
    transaction::{FinalTransaction, PartialOutput, partial_input::IssuanceInput},
};

use crate::{
    transactions::{core::SimplexInput, utility::UtilityTransactionError},
    utils::LendingOfferParameters,
};

pub const UTILITY_NFTS_COUNT: usize = 4;

pub fn issue_utility_nfts(
    issuance_inputs: Vec<SimplexInput>,
    utility_nfts_output_script: Script,
    lending_offer_params: &LendingOfferParameters,
    amounts_decimals: u8,
    issuance_asset_entropy: [u8; 32],
    network: SimplicityNetwork,
) -> Result<FinalTransaction, UtilityTransactionError> {
    let mut ft = FinalTransaction::new(network);

    if issuance_inputs.len() != UTILITY_NFTS_COUNT {
        return Err(UtilityTransactionError::InvalidIssuanceInputsCount {
            expected_count: UTILITY_NFTS_COUNT,
            actual_count: issuance_inputs.len(),
        });
    }

    let (first_parameters_nft_amount, second_parameters_nft_amount) =
        lending_offer_params.encode_parameters_nft_amounts(amounts_decimals)?;

    let utility_nfts_amounts = [
        first_parameters_nft_amount,
        second_parameters_nft_amount,
        1,
        1,
    ];
    let mut asset_ids: Vec<AssetId> = Vec::with_capacity(UTILITY_NFTS_COUNT);

    for (index, input) in issuance_inputs.iter().enumerate() {
        let asset_id = ft.add_issuance_input(
            input.partial_input().clone(),
            IssuanceInput::new(utility_nfts_amounts[index], issuance_asset_entropy),
            input.required_sig().clone(),
        )?;
        asset_ids.push(asset_id);
    }

    for (index, asset_id) in asset_ids.into_iter().enumerate() {
        ft.add_output(PartialOutput::new(
            utility_nfts_output_script.clone(),
            utility_nfts_amounts[index],
            asset_id,
        ));
    }

    for input in issuance_inputs {
        ft.add_output(input.new_partial_output());
    }

    Ok(ft)
}
