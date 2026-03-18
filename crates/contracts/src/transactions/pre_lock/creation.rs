use simplex::simplicityhl::elements::{AssetId, hashes::sha256};
use simplex::{
    provider::SimplicityNetwork,
    transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature},
};
use simplicityhl::elements::Script;

use crate::{
    artifacts::{
        pre_lock::derived_pre_lock::PreLockArguments,
        script_auth::derived_script_auth::ScriptAuthArguments,
    },
    programs::{PreLock, ScriptAuth, program::SimplexProgram},
    transactions::pre_lock::PreLockTransactionError,
};

pub fn create_pre_lock(
    collateral_input: (PartialInput, RequiredSignature),
    first_parameters_nft_input: (PartialInput, RequiredSignature),
    second_parameters_nft_input: (PartialInput, RequiredSignature),
    borrower_nft_input: (PartialInput, RequiredSignature),
    lender_nft_input: (PartialInput, RequiredSignature),
    network: SimplicityNetwork,
    arguments: PreLockArguments,
) -> Result<(FinalTransaction, PreLock), PreLockTransactionError> {
    let mut ft = FinalTransaction::new(network);

    let pre_lock = PreLock::new(arguments.clone(), network);

    let first_parameters_nft_amount = first_parameters_nft_input.0.amount.unwrap();
    let second_parameters_nft_amount = second_parameters_nft_input.0.amount.unwrap();

    ft.add_input(collateral_input.0, collateral_input.1)?;
    ft.add_input(first_parameters_nft_input.0, first_parameters_nft_input.1)?;
    ft.add_input(second_parameters_nft_input.0, second_parameters_nft_input.1)?;
    ft.add_input(borrower_nft_input.0, borrower_nft_input.1)?;
    ft.add_input(lender_nft_input.0, lender_nft_input.1)?;

    let pre_lock_cov_hash = pre_lock.get_script_hash()?;
    let utility_nfts_script_auth = ScriptAuth::new(
        ScriptAuthArguments {
            script_hash: pre_lock_cov_hash,
        },
        network,
    );

    let collateral_asset_id = AssetId::from_inner(sha256::Midstate(arguments.collateral_asset_id));
    let first_parameters_nft_asset_id =
        AssetId::from_inner(sha256::Midstate(arguments.first_parameters_nft_asset_id));
    let second_parameters_nft_asset_id =
        AssetId::from_inner(sha256::Midstate(arguments.second_parameters_nft_asset_id));
    let borrower_nft_asset_id =
        AssetId::from_inner(sha256::Midstate(arguments.borrower_nft_asset_id));
    let lender_nft_asset_id = AssetId::from_inner(sha256::Midstate(arguments.lender_nft_asset_id));

    pre_lock.add_program_output(&mut ft, collateral_asset_id, arguments.collateral_amount)?;
    utility_nfts_script_auth.add_program_output(
        &mut ft,
        first_parameters_nft_asset_id,
        first_parameters_nft_amount,
    )?;
    utility_nfts_script_auth.add_program_output(
        &mut ft,
        second_parameters_nft_asset_id,
        second_parameters_nft_amount,
    )?;
    utility_nfts_script_auth.add_program_output(&mut ft, borrower_nft_asset_id, 1)?;
    utility_nfts_script_auth.add_program_output(&mut ft, lender_nft_asset_id, 1)?;

    let mut op_return_data = [0u8; 64];
    op_return_data[..32].copy_from_slice(&arguments.borrower_pub_key);
    op_return_data[32..].copy_from_slice(&arguments.principal_asset_id);

    ft.add_output(PartialOutput::new(
        Script::new_op_return(&op_return_data),
        0,
        AssetId::default(),
    ));

    Ok((ft, pre_lock))
}
