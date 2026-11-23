use simplex::TestContext;
use simplex::program::ProgramError;
use simplex::signer::SignerError;
use simplex::transaction::FinalTransaction;

use crate::support::chain;

/// Broadcasts `ft` and waits for it to be confirmed.
pub fn accepts(context: &TestContext, ft: &FinalTransaction) -> anyhow::Result<()> {
    chain::broadcast(context, ft)?;

    Ok(())
}

/// Asserts that the covenant at input `covenant_input` rejects `ft`: its program fails while it
/// runs.
///
/// Any other error means the test setup is broken and the covenant was never reached, e.g. the
/// program of the input is not the one its UTXO is locked to.
#[track_caller]
pub fn rejects(context: &TestContext, ft: &FinalTransaction, covenant_input: usize) {
    let ft = chain::with_explicit_change(context, ft);

    match context.get_default_signer().finalize(&ft) {
        Err(SignerError::CovenantExecution {
            index,
            source: ProgramError::Execution(_) | ProgramError::Pruning(_),
            ..
        }) => assert_eq!(
            index, covenant_input,
            "the covenant at input {index} rejected, expected input {covenant_input}"
        ),
        Err(other) => panic!("the setup failed before the covenant ran: {other}"),
        Ok(_) => panic!("expected input {covenant_input} to reject, but the transaction is valid"),
    }
}
