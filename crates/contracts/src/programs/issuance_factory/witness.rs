use simplex::{
    constants::DUMMY_SIGNATURE,
    either::Either::{Left, Right},
};

use crate::artifacts::issuance_factory::derived_issuance_factory::IssuanceFactoryWitness;

#[derive(Debug, Clone, Copy)]
pub enum IssuanceFactoryWitnessBranch {
    IssueAssets { output_index: u32 },
    RemoveFactory { output_index: u32 },
}

impl IssuanceFactoryWitnessBranch {
    pub fn build_witness(&self) -> Box<IssuanceFactoryWitness> {
        let path = match self {
            IssuanceFactoryWitnessBranch::IssueAssets { output_index } => {
                Left((*output_index, DUMMY_SIGNATURE))
            }
            IssuanceFactoryWitnessBranch::RemoveFactory { output_index } => {
                Right((*output_index, DUMMY_SIGNATURE))
            }
        };

        Box::new(IssuanceFactoryWitness { path })
    }
}
