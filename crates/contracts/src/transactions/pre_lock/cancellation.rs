use simplex::simplicityhl::elements::{AssetId, hashes::sha256};
use simplex::{
    provider::SimplicityNetwork,
    transaction::{FinalTransaction, PartialOutput},
};
use simplicityhl::elements::{OutPoint, Script, TxOut};

use crate::{
    artifacts::script_auth::derived_script_auth::ScriptAuthArguments,
    programs::{PreLock, PreLockBranch, ScriptAuth, program::SimplexProgram},
    transactions::pre_lock::PreLockTransactionError,
};

pub fn cancel_pre_lock(
    pre_lock_utxo: (OutPoint, TxOut),
    first_parameters_nft_utxo: (OutPoint, TxOut),
    second_parameters_nft_utxo: (OutPoint, TxOut),
    borrower_nft_utxo: (OutPoint, TxOut),
    lender_nft_utxo: (OutPoint, TxOut),
    collateral_output: PartialOutput,
    pre_lock: PreLock,
    network: SimplicityNetwork,
) -> Result<FinalTransaction, PreLockTransactionError> {
    let mut ft = FinalTransaction::new(network);

    let first_parameters_nft_amount = first_parameters_nft_utxo.1.value.explicit().unwrap();
    let second_parameters_nft_amount = second_parameters_nft_utxo.1.value.explicit().unwrap();

    let pre_lock_witness = PreLock::get_pre_lock_witness(&PreLockBranch::PreLockCancellation);
    pre_lock.add_program_input_with_signature(
        &mut ft,
        pre_lock_utxo,
        Box::new(pre_lock_witness),
        "SIGNATURE".into(),
    )?;

    let pre_lock_cov_hash = pre_lock.get_script_hash()?;
    let utility_nfts_script_auth = ScriptAuth::new(
        ScriptAuthArguments {
            script_hash: pre_lock_cov_hash,
        },
        network,
    );
    let utility_nfts_witness = ScriptAuth::get_script_auth_witness(0);

    utility_nfts_script_auth.add_program_input(
        &mut ft,
        first_parameters_nft_utxo,
        Box::new(utility_nfts_witness.clone()),
    )?;
    utility_nfts_script_auth.add_program_input(
        &mut ft,
        second_parameters_nft_utxo,
        Box::new(utility_nfts_witness.clone()),
    )?;
    utility_nfts_script_auth.add_program_input(
        &mut ft,
        borrower_nft_utxo,
        Box::new(utility_nfts_witness.clone()),
    )?;
    utility_nfts_script_auth.add_program_input(
        &mut ft,
        lender_nft_utxo,
        Box::new(utility_nfts_witness.clone()),
    )?;

    ft.add_output(collateral_output);

    let pre_lock_arguments = pre_lock.get_pre_lock_arguments();

    let first_parameters_nft_asset_id = AssetId::from_inner(sha256::Midstate(
        pre_lock_arguments.first_parameters_nft_asset_id,
    ));
    let second_parameters_nft_asset_id = AssetId::from_inner(sha256::Midstate(
        pre_lock_arguments.second_parameters_nft_asset_id,
    ));
    let borrower_nft_asset_id =
        AssetId::from_inner(sha256::Midstate(pre_lock_arguments.borrower_nft_asset_id));
    let lender_nft_asset_id =
        AssetId::from_inner(sha256::Midstate(pre_lock_arguments.lender_nft_asset_id));

    ft.add_output(PartialOutput::new(
        Script::new_op_return(b"burn"),
        first_parameters_nft_amount,
        first_parameters_nft_asset_id,
    ));

    ft.add_output(PartialOutput::new(
        Script::new_op_return(b"burn"),
        second_parameters_nft_amount,
        second_parameters_nft_asset_id,
    ));

    ft.add_output(PartialOutput::new(
        Script::new_op_return(b"burn"),
        1,
        borrower_nft_asset_id,
    ));

    ft.add_output(PartialOutput::new(
        Script::new_op_return(b"burn"),
        1,
        lender_nft_asset_id,
    ));

    Ok(ft)
}
