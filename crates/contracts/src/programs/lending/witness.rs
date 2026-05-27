use simplex::either::Either::{Left, Right};

use crate::artifacts::lending::derived_lending::LendingWitness;

#[derive(Debug, Clone, Copy)]
pub enum LendingOfferWitnessBranch {
    OfferAcceptance,
    OfferCancellation,
    PartialRepayment {
        current_debt: u64,
        amount_to_repay: u64,
    },
    FullRepayment {
        current_debt: u64,
    },
    Liquidation {
        current_debt: u64,
    },
}

impl LendingOfferWitnessBranch {
    pub fn build_witness(&self) -> Box<LendingWitness> {
        let path = match self {
            LendingOfferWitnessBranch::OfferAcceptance => Left(Left(())),
            LendingOfferWitnessBranch::OfferCancellation => Left(Right(())),
            LendingOfferWitnessBranch::PartialRepayment {
                current_debt,
                amount_to_repay,
            } => Right(Left(Left((*current_debt, *amount_to_repay)))),
            LendingOfferWitnessBranch::FullRepayment { current_debt } => {
                Right(Left(Right(*current_debt)))
            }
            LendingOfferWitnessBranch::Liquidation { current_debt } => Right(Right(*current_debt)),
        };

        Box::new(LendingWitness { path })
    }
}
