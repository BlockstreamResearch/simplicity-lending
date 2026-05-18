use simplex::{
    constants::DUMMY_SIGNATURE,
    either::Either::{Left, Right},
};

use crate::artifacts::lending::derived_lending::LendingWitness;

#[derive(Debug, Clone, Copy)]
pub enum LendingWitnessBranch {
    OfferAcceptance,
    OfferCancellation,
    PartialLoanRepayment { amount_to_repay: u64 },
    FullLoanRepayment,
    LoanLiquidation,
}

impl LendingWitnessBranch {
    pub fn build_witness(&self) -> Box<LendingWitness> {
        let path = match self {
            LendingWitnessBranch::OfferAcceptance => Left(Left(())),
            LendingWitnessBranch::OfferCancellation => Left(Right(DUMMY_SIGNATURE)),
            LendingWitnessBranch::PartialLoanRepayment { amount_to_repay } => {
                Right(Left(Left(*amount_to_repay)))
            }
            LendingWitnessBranch::FullLoanRepayment => Right(Left(Right(()))),
            LendingWitnessBranch::LoanLiquidation => Right(Right(())),
        };

        Box::new(LendingWitness { path })
    }
}
