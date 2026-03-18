use simplex::either::Either::{Left, Right};
use simplex::program::Program;
use simplex::simplicityhl::elements::secp256k1_zkp::XOnlyPublicKey;
use simplex::{provider::SimplicityNetwork, utils::tr_unspendable_key};

use crate::artifacts::lending::LendingProgram;
use crate::artifacts::lending::derived_lending::{LendingArguments, LendingWitness};
use crate::programs::program::SimplexProgram;

pub struct Lending {
    arguments: LendingArguments,
    program: LendingProgram,
    network: SimplicityNetwork,
}

#[derive(Debug, Clone, Copy)]
pub enum LendingBranch {
    LoanRepayment,
    LoanLiquidation,
}

impl Lending {
    pub fn new(arguments: LendingArguments, network: SimplicityNetwork) -> Lending {
        Self::from_internal_key(tr_unspendable_key(), arguments, network)
    }

    pub fn from_internal_key(
        internal_key: XOnlyPublicKey,
        arguments: LendingArguments,
        network: SimplicityNetwork,
    ) -> Lending {
        Lending {
            arguments: arguments.clone(),
            program: LendingProgram::new(internal_key, arguments),
            network,
        }
    }

    pub fn get_lending_witness(witness_branch: &LendingBranch) -> LendingWitness {
        let path = match witness_branch {
            LendingBranch::LoanRepayment => Left(()),
            LendingBranch::LoanLiquidation => Right(()),
        };

        LendingWitness { path }
    }

    pub fn get_lending_arguments(&self) -> &LendingArguments {
        &self.arguments
    }
}

impl SimplexProgram for Lending {
    fn get_program(&self) -> &Program {
        self.program.get_program()
    }

    fn get_network(&self) -> &SimplicityNetwork {
        &self.network
    }
}
