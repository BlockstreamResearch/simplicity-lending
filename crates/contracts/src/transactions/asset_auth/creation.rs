use simplex::{
    provider::SimplicityNetwork,
    transaction::{FinalTransaction, PartialInput, RequiredSignature},
};

use crate::{
    artifacts::asset_auth::derived_asset_auth::AssetAuthArguments,
    programs::{AssetAuth, program::SimplexProgram},
    transactions::asset_auth::AssetAuthTransactionError,
};

pub fn create_asset_auth(
    input_to_lock: (PartialInput, RequiredSignature),
    network: SimplicityNetwork,
    arguments: AssetAuthArguments,
) -> Result<(FinalTransaction, AssetAuth), AssetAuthTransactionError> {
    let amount_to_lock = input_to_lock.0.amount.unwrap();

    create_asset_auth_with_amount(input_to_lock, amount_to_lock, network, arguments)
}

pub fn create_asset_auth_with_amount(
    input_to_lock: (PartialInput, RequiredSignature),
    amount_to_lock: u64,
    network: SimplicityNetwork,
    arguments: AssetAuthArguments,
) -> Result<(FinalTransaction, AssetAuth), AssetAuthTransactionError> {
    let asset_auth = AssetAuth::new(arguments, network.clone());
    let mut ft = FinalTransaction::new(network);

    let (partial_input_to_lock, required_sig) = input_to_lock;

    let asset_id_to_lock = partial_input_to_lock.asset.unwrap();

    ft.add_input(partial_input_to_lock, required_sig)?;

    asset_auth.add_program_output(&mut ft, asset_id_to_lock, amount_to_lock)?;

    Ok((ft, asset_auth))
}
