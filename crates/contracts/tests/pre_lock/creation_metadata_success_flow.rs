use lending_contracts::programs::pre_lock::{PreLock, PreLockParameters};
use lending_contracts::programs::program::SimplexProgram;
use lending_contracts::utils::LendingOfferParameters;
use simplex::simplicityhl::elements::{Transaction, Txid};

use super::setup::setup_pre_lock;

fn op_return_payload(tx: &Transaction) -> Vec<u8> {
    let mut op_return_instr_iter = tx.output[5].script_pubkey.instructions_minimal();

    op_return_instr_iter.next();

    op_return_instr_iter
        .next()
        .unwrap()
        .unwrap()
        .push_bytes()
        .unwrap()
        .to_vec()
}

fn setup_default_pre_lock(
    context: &simplex::TestContext,
) -> anyhow::Result<(Txid, PreLock, PreLockParameters)> {
    let provider = context.get_default_provider();
    let principal_asset_amount = 20000;
    let current_height = provider.fetch_tip_height()?;

    let offer_parameters = LendingOfferParameters {
        collateral_amount: 3000,
        principal_amount: 10000,
        loan_expiration_time: current_height + 60,
        principal_interest_rate: 1000,
    };

    setup_pre_lock(context, offer_parameters, principal_asset_amount)
}

#[simplex::test]
fn creates_pre_lock_with_covenant_metadata(context: simplex::TestContext) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let (pre_lock_creation_txid, pre_lock, pre_lock_parameters) = setup_default_pre_lock(&context)?;

    let pre_lock_creation_tx = provider.fetch_transaction(&pre_lock_creation_txid)?;
    let op_return_data = op_return_payload(&pre_lock_creation_tx);

    assert!(pre_lock_creation_tx.output[5].is_null_data());
    assert_eq!(op_return_data.len(), 68);
    assert_eq!(
        &op_return_data[0..4],
        pre_lock.get_program_source_code_hash().as_slice()
    );
    assert_eq!(
        &op_return_data[4..36],
        pre_lock_parameters.borrower_pubkey.serialize().as_slice()
    );
    assert_eq!(
        &op_return_data[36..68],
        pre_lock_parameters
            .principal_asset_id
            .into_inner()
            .0
            .as_slice()
    );

    Ok(())
}

#[simplex::test]
fn decodes_pre_lock_creation_metadata(context: simplex::TestContext) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let (pre_lock_creation_txid, pre_lock, pre_lock_parameters) = setup_default_pre_lock(&context)?;

    let pre_lock_creation_tx = provider.fetch_transaction(&pre_lock_creation_txid)?;
    let decoded_op_return_data =
        PreLock::decode_creation_op_return_data(op_return_payload(&pre_lock_creation_tx))?;

    assert_eq!(
        decoded_op_return_data.covenant_id,
        pre_lock.get_program_source_code_hash()
    );
    assert_eq!(
        decoded_op_return_data.borrower_pubkey,
        pre_lock_parameters.borrower_pubkey
    );
    assert_eq!(
        decoded_op_return_data.principal_asset_id,
        pre_lock_parameters.principal_asset_id
    );

    Ok(())
}
