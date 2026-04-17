use simplex::either::Either::{Left, Right};

use crate::artifacts::lending::derived_lending::LendingWitness;

#[derive(Debug, Clone, Copy)]
pub enum LendingWitnessBranch {
    LoanRepayment,
    LoanLiquidation,
}

impl LendingWitnessBranch {
    pub fn build_witness(&self) -> Box<LendingWitness> {
        let path = match self {
            LendingWitnessBranch::LoanRepayment => Left(()),
            LendingWitnessBranch::LoanLiquidation => Right(()),
        };

        Box::new(LendingWitness { path })
    }
}
