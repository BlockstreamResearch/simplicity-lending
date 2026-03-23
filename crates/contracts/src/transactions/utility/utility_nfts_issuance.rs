use simplex::{
    provider::SimplicityNetwork,
    transaction::{
        FinalTransaction, PartialInput, PartialOutput, RequiredSignature,
        partial_input::IssuanceInput,
    },
};
use simplicityhl::elements::{AssetId, Script};

use crate::{transactions::utility::UtilityTransactionError, utils::LendingOfferParameters};

pub const UTILITY_NFTS_COUNT: usize = 4;

pub fn issue_utility_nfts(
    issuance_inputs: Vec<(PartialInput, RequiredSignature)>,
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

    let utility_nfts_amounts = vec![
        first_parameters_nft_amount,
        second_parameters_nft_amount,
        1,
        1,
    ];
    let mut asset_ids: Vec<AssetId> = Vec::with_capacity(UTILITY_NFTS_COUNT);

    for (index, (input, required_sig)) in issuance_inputs.iter().enumerate() {
        let asset_id = ft.add_issuance_input(
            input.clone(),
            IssuanceInput::new(utility_nfts_amounts[index], issuance_asset_entropy),
            required_sig.clone(),
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

    for (input, _) in issuance_inputs {
        let input_script = input.witness_utxo.script_pubkey;

        ft.add_output(PartialOutput::new(
            input_script,
            input.amount.unwrap(),
            input.asset.unwrap(),
        ));
    }

    Ok(ft)
}
