use lending_contracts::programs::program::SimplexProgram;

use simplex::transaction::FinalTransaction;

use super::setup::setup_issuance_factory;

#[simplex::test]
fn fails_to_remove_issuance_factory_with_invalid_signer(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();

    let (issuance_factory, _) = setup_issuance_factory(&context, 2, 0)?;

    let random_signer = context.random_signer();

    let mut ft = FinalTransaction::new();

    let issuance_factory_utxo =
        provider.fetch_scripthash_utxos(&issuance_factory.get_script_pubkey())?[0].clone();

    issuance_factory.attach_factory_removing(&mut ft, issuance_factory_utxo);

    let result = random_signer.finalize(&ft);

    assert!(result.is_err(), "Must fail but it does not");

    Ok(())
}
