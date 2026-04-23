use simplex::{
    constants::DUMMY_SIGNATURE,
    either::Either::{Left, Right},
};

use crate::artifacts::pre_lock::derived_pre_lock::PreLockWitness;

#[derive(Debug, Clone, Copy)]
pub enum PreLockWitnessBranch {
    LendingCreation,
    PreLockCancellation,
}

impl PreLockWitnessBranch {
    pub fn build_witness(&self) -> Box<PreLockWitness> {
        let path = match self {
            PreLockWitnessBranch::LendingCreation => Left(()),
            PreLockWitnessBranch::PreLockCancellation => Right(DUMMY_SIGNATURE),
        };

        Box::new(PreLockWitness { path })
    }
}
