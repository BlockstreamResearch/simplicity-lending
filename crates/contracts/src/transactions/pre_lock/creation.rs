use simplex::simplicityhl::elements::{AssetId, Script};
use simplex::transaction::{FinalTransaction, PartialOutput};

use crate::programs::PreLockParameters;
use crate::programs::{PreLock, ScriptAuth, program::SimplexProgram};
use crate::transactions::core::SimplexInput;

pub fn create_pre_lock(
    collateral_input: &SimplexInput,
    first_parameters_nft_input: &SimplexInput,
    second_parameters_nft_input: &SimplexInput,
    borrower_nft_input: &SimplexInput,
    lender_nft_input: &SimplexInput,
    parameters: PreLockParameters,
) -> (FinalTransaction, PreLock) {
    let mut ft = FinalTransaction::new();

    ft.add_input(
        collateral_input.partial_input().clone(),
        collateral_input.required_sig().clone(),
    );
    ft.add_input(
        first_parameters_nft_input.partial_input().clone(),
        first_parameters_nft_input.required_sig().clone(),
    );
    ft.add_input(
        second_parameters_nft_input.partial_input().clone(),
        second_parameters_nft_input.required_sig().clone(),
    );
    ft.add_input(
        borrower_nft_input.partial_input().clone(),
        borrower_nft_input.required_sig().clone(),
    );
    ft.add_input(
        lender_nft_input.partial_input().clone(),
        lender_nft_input.required_sig().clone(),
    );

    let pre_lock = PreLock::new(parameters);
    let utility_nfts_script_auth = ScriptAuth::from_simplex_program(&pre_lock);

    pre_lock.add_program_output(
        &mut ft,
        parameters.collateral_asset_id,
        parameters.offer_parameters.collateral_amount,
    );
    utility_nfts_script_auth.add_program_output(
        &mut ft,
        parameters.first_parameters_nft_asset_id,
        first_parameters_nft_input.explicit_amount(),
    );
    utility_nfts_script_auth.add_program_output(
        &mut ft,
        parameters.second_parameters_nft_asset_id,
        second_parameters_nft_input.explicit_amount(),
    );
    utility_nfts_script_auth.add_program_output(&mut ft, parameters.borrower_nft_asset_id, 1);
    utility_nfts_script_auth.add_program_output(&mut ft, parameters.lender_nft_asset_id, 1);

    let op_return_data = pre_lock.encode_creation_op_return_data();

    ft.add_output(PartialOutput::new(
        Script::new_op_return(&op_return_data),
        0,
        AssetId::default(),
    ));

    (ft, pre_lock)
}
