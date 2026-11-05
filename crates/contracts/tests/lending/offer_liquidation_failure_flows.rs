use lending_contracts::programs::asset_auth_vault::AssetAuthVaultWitnessBranch;
use lending_contracts::programs::program::SimplexProgram;
use simplex::simplicityhl::elements::{LockTime, Script, Sequence};
use simplex::transaction::{FinalTransaction, NativeSignature, PartialInput, PartialOutput};

use super::offer_liquidation_success_flows::default_offer_liquidation_setup;
use super::setup::{get_lender_vault_utxo, partial_repay_offer};

#[simplex::test]
fn lender_vault_withdraw_on_liquidation_fails_before_loan_expiration(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let lender = context.random_signer();

    let (mut lending_offer, offer_parameters) = default_offer_liquidation_setup(&context, &lender)?;

    partial_repay_offer(
        &context,
        &mut lending_offer,
        context.get_default_signer(),
        3000,
    )?;

    let loan_expiration_time = offer_parameters.offer_parameters.loan_expiration_time;
    context
        .get_network_utils()
        .mine_until_height(u64::from(loan_expiration_time) + 1)?;

    let lender_nft_utxo = lender.get_utxos_asset(offer_parameters.lender_nft_asset_id)?[0].clone();
    let lender_vault_utxo = get_lender_vault_utxo(&context, &lending_offer)?;
    let lender_vault_amount = lender_vault_utxo.explicit_amount();
    let lender_vault = lending_offer.get_lender_vault();

    let mut ft = FinalTransaction::new();

    ft.add_input(
        PartialInput::new(lender_nft_utxo.clone()),
        Some(NativeSignature::Ecdsa),
    );
    ft.add_output(PartialOutput::new(
        Script::new_op_return(b"burn"),
        lender_nft_utxo.explicit_amount(),
        lender_nft_utxo.explicit_asset(),
    ));

    let lender_vault_input = PartialInput::new(lender_vault_utxo)
        .with_sequence(Sequence::ENABLE_LOCKTIME_NO_RBF)
        .with_locktime(LockTime::from_height(loan_expiration_time - 1)?);

    lender_vault.add_program_input_from_partial_input(
        &mut ft,
        lender_vault_input,
        AssetAuthVaultWitnessBranch::WithdrawOnLiquidation {
            input_keeper_index: 0,
            output_keeper_index: 0,
            already_supplied: lender_vault.get_already_supplied_amount(),
        }
        .build_witness(),
    );

    ft.add_output(PartialOutput::new(
        lender.get_address().script_pubkey(),
        lender_vault_amount,
        offer_parameters.principal_asset_id,
    ));

    assert!(
        lender.finalize(&ft).is_err(),
        "expected finalize to fail, but it succeeded"
    );

    Ok(())
}
