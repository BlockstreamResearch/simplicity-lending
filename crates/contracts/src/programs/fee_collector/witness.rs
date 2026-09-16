use simplex::constants::DUMMY_SIGNATURE;
use simplex::either::Either::{Left, Right};

use crate::artifacts::fee_collector::derived_fee_collector::FeeCollectorWitness;

#[derive(Debug, Clone, Copy)]
pub enum FeeCollectorWitnessBranch {
    Withdrawal,
    Deposit {
        output_index: u32,
        additional_amount: u64,
    },
}

impl FeeCollectorWitnessBranch {
    pub fn build_witness(&self) -> Box<FeeCollectorWitness> {
        let path = match self {
            FeeCollectorWitnessBranch::Withdrawal => Left(DUMMY_SIGNATURE),
            FeeCollectorWitnessBranch::Deposit {
                output_index,
                additional_amount,
            } => Right((*output_index, *additional_amount)),
        };

        Box::new(FeeCollectorWitness { path })
    }
}
