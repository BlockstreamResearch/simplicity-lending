use simplex::fuzz::FuzzProgramTrait;
use simplex::program::ProgramSchema;

use crate::support::expect::{self, Rejection};

/// The witness of the program a case runs on.
pub type WitnessOf<C> = <<C as DispatchCase>::Program as ProgramSchema>::Witness;

/// One call of a test program: the program, holding whatever storage the call reads, and the
/// witness that selects the function and carries its arguments and expected result.
pub trait DispatchCase: Clone + 'static {
    type Program: FuzzProgramTrait;

    fn program(&self) -> Self::Program;

    fn witness(&self) -> WitnessOf<Self>;

    #[track_caller]
    fn accepts(&self) {
        expect::accepts(self.program().as_ref(), self.witness());
    }

    #[track_caller]
    fn rejects(&self, reason: Rejection) {
        expect::rejects(self.program().as_ref(), self.witness(), reason);
    }
}
