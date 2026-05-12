use simplex::either::Either::{Left, Right};

use crate::artifacts::lending::derived_lending::LendingWitness;

#[derive(Debug, Clone, Copy)]
pub enum LendingWitnessBranch {
    PartialLoanRepayment { amount_to_repay: u64 },
    FullLoanRepayment,
    LoanLiquidation,
}

impl LendingWitnessBranch {
    pub fn build_witness(&self) -> Box<LendingWitness> {
        let path = match self {
            LendingWitnessBranch::PartialLoanRepayment { amount_to_repay } => {
                Left(Left(*amount_to_repay))
            }
            LendingWitnessBranch::FullLoanRepayment => Left(Right(())),
            LendingWitnessBranch::LoanLiquidation => Right(()),
        };

        Box::new(LendingWitness { path })
    }
}
