use simplex::simplicityhl::elements::{AssetId, Script};
use simplex::{
    provider::SimplicityNetwork,
    transaction::{FinalTransaction, PartialOutput, partial_input::IssuanceInput},
};

use crate::transactions::core::SimplexInput;
use crate::{
    transactions::utility::{UTILITY_NFTS_COUNT, UtilityTransactionError},
    utils::get_random_seed,
};

pub const PREPARATION_UTXO_ASSET_AMOUNT: u64 = 10;

pub fn issue_preparation_utxos(
    issuance_input: &SimplexInput,
    issuance_utxos_output_script: Script,
    network: SimplicityNetwork,
) -> Result<(FinalTransaction, AssetId), UtilityTransactionError> {
    let mut ft = FinalTransaction::new();

    let total_asset_amount = PREPARATION_UTXO_ASSET_AMOUNT * UTILITY_NFTS_COUNT as u64;
    let asset_entropy = get_random_seed();

    let asset_id = ft.add_issuance_input(
        issuance_input.partial_input().clone(),
        IssuanceInput::new(total_asset_amount, asset_entropy),
        issuance_input.required_sig().clone(),
    )?;

    for _ in 0..UTILITY_NFTS_COUNT {
        ft.add_output(PartialOutput::new(
            issuance_utxos_output_script.clone(),
            PREPARATION_UTXO_ASSET_AMOUNT,
            asset_id,
        ));
    }

    if issuance_input.explicit_asset() != network.policy_asset() {
        ft.add_output(issuance_input.new_partial_output());
    }

    Ok((ft, asset_id))
}
