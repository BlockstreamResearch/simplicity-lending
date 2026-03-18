use simplex::simplicityhl::elements::{AssetId, hashes::sha256};
use simplex::{
    provider::SimplicityNetwork,
    transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature},
};
use simplicityhl::elements::{OutPoint, Script, TxOut};

use crate::{
    artifacts::{
        asset_auth::derived_asset_auth::AssetAuthArguments,
        lending::derived_lending::LendingArguments,
        script_auth::derived_script_auth::ScriptAuthArguments,
    },
    programs::{AssetAuth, Lending, PreLock, PreLockBranch, ScriptAuth, program::SimplexProgram},
    transactions::pre_lock::PreLockTransactionError,
};

pub fn create_lending_from_pre_lock(
    pre_lock_utxo: (OutPoint, TxOut),
    first_parameters_nft_utxo: (OutPoint, TxOut),
    second_parameters_nft_utxo: (OutPoint, TxOut),
    borrower_nft_utxo: (OutPoint, TxOut),
    lender_nft_utxo: (OutPoint, TxOut),
    principal_inputs: Vec<(PartialInput, RequiredSignature)>,
    borrower_script_pubkey: Script,
    lender_nft_output: PartialOutput,
    pre_lock: PreLock,
    network: SimplicityNetwork,
) -> Result<(FinalTransaction, Lending), PreLockTransactionError> {
    let mut ft = FinalTransaction::new(network);

    let first_parameters_nft_amount = first_parameters_nft_utxo.1.value.explicit().unwrap();
    let second_parameters_nft_amount = second_parameters_nft_utxo.1.value.explicit().unwrap();

    let pre_lock_witness = PreLock::get_pre_lock_witness(&PreLockBranch::LendingCreation);
    pre_lock.add_program_input(&mut ft, pre_lock_utxo, Box::new(pre_lock_witness))?;

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

    for (principal_input, required_sig) in principal_inputs {
        ft.add_input(principal_input, required_sig)?;
    }

    let pre_lock_arguments = pre_lock.get_pre_lock_arguments();

    let lender_principal_asset_auth = AssetAuth::new(
        AssetAuthArguments {
            asset_id: pre_lock_arguments.lender_nft_asset_id,
            asset_amount: 1,
            with_asset_burn: true,
        },
        network,
    );

    let lending_arguments = LendingArguments {
        collateral_asset_id: pre_lock_arguments.collateral_asset_id,
        principal_asset_id: pre_lock_arguments.principal_asset_id,
        first_parameters_nft_asset_id: pre_lock_arguments.first_parameters_nft_asset_id,
        second_parameters_nft_asset_id: pre_lock_arguments.second_parameters_nft_asset_id,
        borrower_nft_asset_id: pre_lock_arguments.borrower_nft_asset_id,
        lender_nft_asset_id: pre_lock_arguments.lender_nft_asset_id,
        collateral_amount: pre_lock_arguments.collateral_amount,
        principal_amount: pre_lock_arguments.principal_amount,
        loan_expiration_time: pre_lock_arguments.loan_expiration_time,
        principal_interest_rate: pre_lock_arguments.principal_interest_rate,
        lender_principal_cov_hash: lender_principal_asset_auth.get_script_hash()?,
    };

    let lending = Lending::new(lending_arguments, network);

    let parameter_nfts_script_auth = ScriptAuth::new(
        ScriptAuthArguments {
            script_hash: lending.get_script_hash()?,
        },
        network,
    );

    let collateral_asset_id =
        AssetId::from_inner(sha256::Midstate(pre_lock_arguments.collateral_asset_id));
    let principal_asset_id =
        AssetId::from_inner(sha256::Midstate(pre_lock_arguments.principal_asset_id));
    let first_parameters_nft_asset_id = AssetId::from_inner(sha256::Midstate(
        pre_lock_arguments.first_parameters_nft_asset_id,
    ));
    let second_parameters_nft_asset_id = AssetId::from_inner(sha256::Midstate(
        pre_lock_arguments.second_parameters_nft_asset_id,
    ));
    let borrower_nft_asset_id =
        AssetId::from_inner(sha256::Midstate(pre_lock_arguments.borrower_nft_asset_id));

    lending.add_program_output(
        &mut ft,
        collateral_asset_id,
        pre_lock_arguments.collateral_amount,
    )?;

    ft.add_output(PartialOutput::new(
        borrower_script_pubkey.clone(),
        pre_lock_arguments.principal_amount,
        principal_asset_id,
    ));

    parameter_nfts_script_auth.add_program_output(
        &mut ft,
        first_parameters_nft_asset_id,
        first_parameters_nft_amount,
    )?;
    parameter_nfts_script_auth.add_program_output(
        &mut ft,
        second_parameters_nft_asset_id,
        second_parameters_nft_amount,
    )?;

    ft.add_output(PartialOutput::new(
        borrower_script_pubkey,
        1,
        borrower_nft_asset_id,
    ));
    ft.add_output(lender_nft_output);

    Ok((ft, lending))
}
