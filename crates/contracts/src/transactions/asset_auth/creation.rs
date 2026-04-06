use simplex::transaction::FinalTransaction;

use crate::{
    programs::{AssetAuth, AssetAuthParameters, program::SimplexProgram},
    transactions::core::SimplexInput,
};

pub fn create_asset_auth(
    input_to_lock: &SimplexInput,
    parameters: AssetAuthParameters,
) -> (FinalTransaction, AssetAuth) {
    let amount_to_lock = input_to_lock.explicit_amount();

    create_asset_auth_with_amount(input_to_lock, amount_to_lock, parameters)
}

pub fn create_asset_auth_with_amount(
    input_to_lock: &SimplexInput,
    amount_to_lock: u64,
    parameters: AssetAuthParameters,
) -> (FinalTransaction, AssetAuth) {
    let mut ft = FinalTransaction::new();
    let asset_auth = AssetAuth::new(parameters);

    let asset_id_to_lock = input_to_lock.explicit_asset();

    ft.add_input(
        input_to_lock.partial_input().clone(),
        input_to_lock.required_sig().clone(),
    );

    asset_auth.add_program_output(&mut ft, asset_id_to_lock, amount_to_lock);

    (ft, asset_auth)
}
