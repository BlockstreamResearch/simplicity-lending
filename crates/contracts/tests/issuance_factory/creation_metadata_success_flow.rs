use lending_contracts::programs::issuance_factory::{IssuanceFactory, IssuanceFactoryParameters};
use lending_contracts::programs::program::{
    SimplexProgram, op_return_payload as script_op_return_payload,
};
use simplex::simplicityhl::elements::{Transaction, Txid};

use super::setup::setup_issuance_factory;

fn op_return_payload(tx: &Transaction) -> Vec<u8> {
    script_op_return_payload(&tx.output[1].script_pubkey)
        .unwrap()
        .to_vec()
}

fn setup_default_issuance_factory(
    context: &simplex::TestContext,
) -> anyhow::Result<(Txid, IssuanceFactory, IssuanceFactoryParameters)> {
    let provider = context.get_default_provider();
    let issuing_utxos_count = 3;
    let reissuance_flags = 0x0102_0304_0506_0708;
    let (issuance_factory, issuance_factory_parameters) =
        setup_issuance_factory(context, issuing_utxos_count, reissuance_flags)?;

    let issuance_factory_utxo =
        provider.fetch_scripthash_utxos(&issuance_factory.get_script_pubkey())?[0].clone();

    Ok((
        issuance_factory_utxo.outpoint.txid,
        issuance_factory,
        issuance_factory_parameters,
    ))
}

#[simplex::test]
fn creates_issuance_factory_with_creation_metadata(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let (issuance_factory_creation_txid, issuance_factory, issuance_factory_parameters) =
        setup_default_issuance_factory(&context)?;

    let issuance_factory_creation_tx =
        provider.fetch_transaction(&issuance_factory_creation_txid)?;
    let op_return_data = op_return_payload(&issuance_factory_creation_tx);
    let expected_reissuance_flags = issuance_factory_parameters.reissuance_flags.to_le_bytes();

    assert!(issuance_factory_creation_tx.output[1].is_null_data());
    assert_eq!(op_return_data.len(), 45);
    assert_eq!(
        &op_return_data[0..4],
        issuance_factory.get_program_id().as_slice()
    );
    assert_eq!(
        op_return_data[4],
        issuance_factory_parameters.issuing_utxos_count
    );
    assert_eq!(&op_return_data[5..13], expected_reissuance_flags.as_slice());
    assert_eq!(
        &op_return_data[13..45],
        issuance_factory_parameters
            .owner_pubkey
            .serialize()
            .as_slice()
    );

    Ok(())
}

#[simplex::test]
fn decodes_issuance_factory_creation_metadata(context: simplex::TestContext) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let (issuance_factory_creation_txid, issuance_factory, issuance_factory_parameters) =
        setup_default_issuance_factory(&context)?;

    let issuance_factory_creation_tx =
        provider.fetch_transaction(&issuance_factory_creation_txid)?;
    let decoded_op_return_data = IssuanceFactory::decode_creation_op_return_data(
        op_return_payload(&issuance_factory_creation_tx),
    )?;

    assert_eq!(
        decoded_op_return_data.program_id,
        issuance_factory.get_program_id()
    );
    assert_eq!(
        decoded_op_return_data.issuing_utxos_count,
        issuance_factory_parameters.issuing_utxos_count
    );
    assert_eq!(
        decoded_op_return_data.reissuance_flags,
        issuance_factory_parameters.reissuance_flags
    );
    assert_eq!(
        decoded_op_return_data.owner_pubkey,
        issuance_factory_parameters.owner_pubkey
    );

    Ok(())
}
