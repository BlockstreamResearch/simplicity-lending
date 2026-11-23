use simplex::program::{Program, ProgramError};
use simplex::simplicityhl::WitnessValues;
use simplex::simplicityhl::simplicity::bit_machine::ExecutionError;

use crate::support::execution;

/// Why a program rejects a case.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Rejection {
    /// A jet failed: an `assert!`, an `assert_eq_*` or a narrowing that does not fit.
    Assertion,
    /// Execution reached a pruned branch: `unwrap(None)`, as in an overflowing `add_64`.
    PrunedBranch,
}

#[track_caller]
pub fn accepts(program: &Program, witness: impl Into<WitnessValues>) {
    if let Err(rejection) = outcome(program, witness) {
        panic!("expected the program to accept, but it rejected with {rejection:?}");
    }
}

/// Asserts that `program` rejects `witness` for `reason`.
#[track_caller]
pub fn rejects(program: &Program, witness: impl Into<WitnessValues>, reason: Rejection) {
    match outcome(program, witness) {
        Ok(()) => panic!("expected the program to reject with {reason:?}, but it accepted"),
        Err(rejection) => assert_eq!(rejection, reason, "the program rejected for another reason"),
    }
}

/// Runs `program` on `witness`.
///
/// # Panics
/// Panics when the case fails before the program runs, e.g. on a malformed witness: such a case
/// says nothing about the program.
#[track_caller]
fn outcome(program: &Program, witness: impl Into<WitnessValues>) -> Result<(), Rejection> {
    let execution = match execution::run(program, witness) {
        Ok(()) => return Ok(()),
        Err(ProgramError::Pruning(execution) | ProgramError::Execution(execution)) => execution,
        Err(other) => panic!("the case failed before the program ran: {other}"),
    };

    match execution {
        ExecutionError::JetFailed(_) => Err(Rejection::Assertion),
        ExecutionError::ReachedPrunedBranch(_) => Err(Rejection::PrunedBranch),
        other => panic!("the program failed outside of its logic: {other}"),
    }
}
