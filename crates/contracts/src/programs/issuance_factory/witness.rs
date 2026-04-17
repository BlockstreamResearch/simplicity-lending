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
        let (output_index, path) = match self {
            IssuanceFactoryWitnessBranch::IssueAssets { output_index } => (*output_index, Left(())),
            IssuanceFactoryWitnessBranch::RemoveFactory { output_index } => {
                (*output_index, Right(()))
            }
        };

        Box::new(IssuanceFactoryWitness {
            path,
            output_index,
            signature: DUMMY_SIGNATURE,
        })
    }
}
