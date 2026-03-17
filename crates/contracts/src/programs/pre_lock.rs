use simplex::either::Either::{Left, Right};
use simplex::simplex_sdk::constants::DUMMY_SIGNATURE;
use simplex::simplex_sdk::program::Program;
use simplex::simplex_sdk::{provider::SimplicityNetwork, utils::tr_unspendable_key};
use simplex::simplicityhl::elements::secp256k1_zkp::XOnlyPublicKey;

use crate::artifacts::pre_lock::PreLockProgram;
use crate::artifacts::pre_lock::derived_pre_lock::{PreLockArguments, PreLockWitness};
use crate::programs::program::SimplexProgram;

pub struct PreLock {
    arguments: PreLockArguments,
    program: PreLockProgram,
    network: SimplicityNetwork,
}

#[derive(Debug, Clone, Copy)]
pub enum PreLockBranch {
    LendingCreation,
    PreLockCancellation,
}

impl PreLock {
    pub fn new(arguments: PreLockArguments, network: SimplicityNetwork) -> PreLock {
        Self::from_internal_key(tr_unspendable_key(), arguments, network)
    }

    pub fn from_internal_key(
        internal_key: XOnlyPublicKey,
        arguments: PreLockArguments,
        network: SimplicityNetwork,
    ) -> PreLock {
        PreLock {
            arguments: arguments.clone(),
            program: PreLockProgram::new(internal_key, arguments),
            network,
        }
    }

    pub fn get_pre_lock_witness(witness_branch: &PreLockBranch) -> PreLockWitness {
        let path = match witness_branch {
            PreLockBranch::LendingCreation => Left(()),
            PreLockBranch::PreLockCancellation => Right(()),
        };

        PreLockWitness {
            path,
            signature: DUMMY_SIGNATURE,
        }
    }

    pub fn get_pre_lock_arguments(&self) -> &PreLockArguments {
        &self.arguments
    }
}

impl SimplexProgram for PreLock {
    fn get_program(&self) -> &Program {
        self.program.get_program()
    }

    fn get_network(&self) -> SimplicityNetwork {
        self.network.clone()
    }
}
