use simplex::program::{Program, ProgramError};
use simplex::simplicityhl::WitnessValues;

use crate::support::execution;

#[track_caller]
pub fn accepts(program: &Program, witness: impl Into<WitnessValues>) {
    if let Err(error) = execution::run(program, witness) {
        panic!("expected the program to accept, but it failed: {error}");
    }
}

/// Asserts that `program` fails while running on `witness`.
///
/// Any other error means the case is malformed and the function was never reached.
#[track_caller]
pub fn rejects(program: &Program, witness: impl Into<WitnessValues>) {
    match execution::run(program, witness) {
        Err(ProgramError::Pruning(_) | ProgramError::Execution(_)) => {}
        Err(other) => panic!("the case failed before the program ran: {other}"),
        Ok(()) => panic!("expected the program to reject, but it accepted"),
    }
}
