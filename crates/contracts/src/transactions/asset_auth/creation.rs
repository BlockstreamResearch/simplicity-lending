use simplex::transaction::FinalTransaction;

use crate::{
    programs::{AssetAuth, AssetAuthParameters, program::SimplexProgram},
    transactions::{asset_auth::AssetAuthTransactionError, core::SimplexInput},
};

pub fn create_asset_auth(
    input_to_lock: &SimplexInput,
    parameters: AssetAuthParameters,
) -> Result<(FinalTransaction, AssetAuth), AssetAuthTransactionError> {
    let amount_to_lock = input_to_lock.explicit_amount();

    create_asset_auth_with_amount(input_to_lock, amount_to_lock, parameters)
}

pub fn create_asset_auth_with_amount(
    input_to_lock: &SimplexInput,
    amount_to_lock: u64,
    parameters: AssetAuthParameters,
) -> Result<(FinalTransaction, AssetAuth), AssetAuthTransactionError> {
    let mut ft = FinalTransaction::new(parameters.network);
    let asset_auth = AssetAuth::new(parameters);

    let asset_id_to_lock = input_to_lock.explicit_asset();

    ft.add_input(
        input_to_lock.partial_input().clone(),
        input_to_lock.required_sig().clone(),
    )?;

    asset_auth.add_program_output(&mut ft, asset_id_to_lock, amount_to_lock)?;

    Ok((ft, asset_auth))
}
