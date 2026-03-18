use simplex::{
    provider::SimplicityNetwork,
    transaction::{
        FinalTransaction, PartialInput, PartialOutput, RequiredSignature,
        partial_input::IssuanceInput,
    },
};
use simplicityhl::elements::Script;

use crate::{
    transactions::utility::{UTILITY_NFTS_COUNT, UtilityTransactionError},
    utils::get_random_seed,
};

pub const PREPARATION_UTXO_ASSET_AMOUNT: u64 = 10;

pub fn issue_preparation_utxos(
    issuance_input: (PartialInput, RequiredSignature),
    issuance_utxos_output_script: Script,
    network: SimplicityNetwork,
) -> Result<FinalTransaction, UtilityTransactionError> {
    let mut ft = FinalTransaction::new(network);

    let total_asset_amount = PREPARATION_UTXO_ASSET_AMOUNT * UTILITY_NFTS_COUNT as u64;
    let asset_entropy = get_random_seed();

    let asset_id = ft.add_issuance_input(
        issuance_input.0.clone(),
        IssuanceInput::new(total_asset_amount, asset_entropy),
        issuance_input.1,
    )?;

    for _ in 0..UTILITY_NFTS_COUNT {
        ft.add_output(PartialOutput::new(
            issuance_utxos_output_script.clone(),
            PREPARATION_UTXO_ASSET_AMOUNT,
            asset_id.clone(),
        ));
    }

    let input_script = issuance_input.0.witness_utxo.script_pubkey;

    ft.add_output(PartialOutput::new(
        input_script,
        issuance_input.0.amount.unwrap(),
        issuance_input.0.asset.unwrap(),
    ));

    Ok(ft)
}
