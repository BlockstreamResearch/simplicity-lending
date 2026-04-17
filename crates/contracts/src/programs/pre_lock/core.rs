use simplex::program::Program;

use simplex::provider::SimplicityNetwork;
use simplex::simplicityhl::elements::hex::ToHex;
use simplex::simplicityhl::elements::secp256k1_zkp::XOnlyPublicKey;
use simplex::simplicityhl::elements::{AssetId, Script};
use simplex::transaction::{FinalTransaction, PartialOutput, UTXO};

use crate::artifacts::pre_lock::PreLockProgram;
use crate::programs::pre_lock::error::PreLockError;
use crate::programs::program::SimplexProgram;
use crate::programs::script_auth::{ScriptAuth, ScriptAuthSchema, ScriptAuthWitnessParams};
use crate::programs::{Lending, LendingSchema, PreLockParameters, PreLockWitnessBranch};

pub struct PreLock {
    program: PreLockProgram,
    parameters: PreLockParameters,
}

#[derive(Debug, Clone)]
pub enum PreLockSchema {
    Create {
        parameter_amounts_decimals: u8,
    },
    CreateLending {
        program_utxo: UTXO,
        first_parameters_nft_utxo: UTXO,
        second_parameters_nft_utxo: UTXO,
        borrower_nft_utxo: UTXO,
        lender_nft_utxo: UTXO,
    },
    Cancel {
        program_utxo: UTXO,
        first_parameters_nft_utxo: UTXO,
        second_parameters_nft_utxo: UTXO,
        borrower_nft_utxo: UTXO,
        lender_nft_utxo: UTXO,
    },
}

pub const PRE_LOCK_CREATION_OP_RETURN_DATA_LENGTH: usize = 64;

impl PreLock {
    pub fn new(parameters: PreLockParameters) -> Self {
        Self {
            program: PreLockProgram::new(parameters.build_arguments()),
            parameters,
        }
    }

    pub fn get_parameters(&self) -> &PreLockParameters {
        &self.parameters
    }

    pub fn decode_creation_op_return_data(
        op_return_bytes: Vec<u8>,
    ) -> Result<(XOnlyPublicKey, AssetId), PreLockError> {
        if op_return_bytes.len() != PRE_LOCK_CREATION_OP_RETURN_DATA_LENGTH {
            return Err(PreLockError::InvalidCreationOpReturnDataLength {
                expected: PRE_LOCK_CREATION_OP_RETURN_DATA_LENGTH,
                actual: op_return_bytes.len(),
            });
        }

        let (op_return_pub_key, op_return_asset_id) = op_return_bytes.split_at(32);

        let principal_asset_id = AssetId::from_slice(op_return_asset_id)?;
        let borrower_public_key = XOnlyPublicKey::from_slice(op_return_pub_key)
            .map_err(|_| PreLockError::InvalidOpReturnBytes(op_return_pub_key.to_hex()))?;

        Ok((borrower_public_key, principal_asset_id))
    }

    pub fn encode_creation_op_return_data(&self) -> Vec<u8> {
        let mut op_return_data = Vec::with_capacity(PRE_LOCK_CREATION_OP_RETURN_DATA_LENGTH);
        op_return_data.extend_from_slice(&self.parameters.borrower_pubkey.serialize());
        op_return_data.extend_from_slice(&self.parameters.principal_asset_id.into_inner().0);

        op_return_data
    }

    pub fn use_schema(&self, ft: &mut FinalTransaction, schema: PreLockSchema) {
        match schema {
            PreLockSchema::Create {
                parameter_amounts_decimals,
            } => self.use_creation_schema(ft, parameter_amounts_decimals),
            PreLockSchema::CreateLending {
                program_utxo,
                first_parameters_nft_utxo,
                second_parameters_nft_utxo,
                borrower_nft_utxo,
                lender_nft_utxo,
            } => self.use_lending_creation_schema(
                ft,
                program_utxo,
                first_parameters_nft_utxo,
                second_parameters_nft_utxo,
                borrower_nft_utxo,
                lender_nft_utxo,
            ),
            PreLockSchema::Cancel {
                program_utxo,
                first_parameters_nft_utxo,
                second_parameters_nft_utxo,
                borrower_nft_utxo,
                lender_nft_utxo,
            } => self.use_cancellation_schema(
                ft,
                program_utxo,
                first_parameters_nft_utxo,
                second_parameters_nft_utxo,
                borrower_nft_utxo,
                lender_nft_utxo,
            ),
        }
    }

    fn use_creation_schema(&self, ft: &mut FinalTransaction, parameter_amounts_decimals: u8) {
        let utility_nfts_script_auth = ScriptAuth::from_simplex_program(self);

        let (first_parameters_nft_amount, second_parameters_nft_amount) = self
            .parameters
            .offer_parameters
            .encode_parameters_nft_amounts(parameter_amounts_decimals)
            .expect("Invalid offer parameters");

        self.add_program_output(
            ft,
            self.parameters.collateral_asset_id,
            self.parameters.offer_parameters.collateral_amount,
        );
        utility_nfts_script_auth.add_program_output(
            ft,
            self.parameters.first_parameters_nft_asset_id,
            first_parameters_nft_amount,
        );
        utility_nfts_script_auth.add_program_output(
            ft,
            self.parameters.second_parameters_nft_asset_id,
            second_parameters_nft_amount,
        );
        utility_nfts_script_auth.add_program_output(ft, self.parameters.borrower_nft_asset_id, 1);
        utility_nfts_script_auth.add_program_output(ft, self.parameters.lender_nft_asset_id, 1);

        let op_return_data = self.encode_creation_op_return_data();

        ft.add_output(PartialOutput::new(
            Script::new_op_return(&op_return_data),
            0,
            AssetId::default(),
        ));
    }

    fn use_lending_creation_schema(
        &self,
        ft: &mut FinalTransaction,
        program_utxo: UTXO,
        first_parameters_nft_utxo: UTXO,
        second_parameters_nft_utxo: UTXO,
        borrower_nft_utxo: UTXO,
        lender_nft_utxo: UTXO,
    ) {
        let pre_lock_input_index = ft.n_inputs() as u32;

        self.add_program_input(
            ft,
            program_utxo,
            PreLockWitnessBranch::LendingCreation.build_witness(),
        );

        let utility_nfts_script_auth = ScriptAuth::from_simplex_program(self);
        let utility_nfts_witness_params = ScriptAuthWitnessParams::new(pre_lock_input_index);

        utility_nfts_script_auth.use_schema(
            ft,
            ScriptAuthSchema::Unlock {
                program_utxo: first_parameters_nft_utxo.clone(),
                witness_params: utility_nfts_witness_params,
            },
        );
        utility_nfts_script_auth.use_schema(
            ft,
            ScriptAuthSchema::Unlock {
                program_utxo: second_parameters_nft_utxo.clone(),
                witness_params: utility_nfts_witness_params,
            },
        );
        utility_nfts_script_auth.use_schema(
            ft,
            ScriptAuthSchema::Unlock {
                program_utxo: borrower_nft_utxo,
                witness_params: utility_nfts_witness_params,
            },
        );
        utility_nfts_script_auth.use_schema(
            ft,
            ScriptAuthSchema::Unlock {
                program_utxo: lender_nft_utxo,
                witness_params: utility_nfts_witness_params,
            },
        );

        let lending = Lending::new(self.parameters.into());

        lending.use_schema(
            ft,
            LendingSchema::Create {
                first_parameters_nft_utxo,
                second_parameters_nft_utxo,
            },
        );
    }

    fn use_cancellation_schema(
        &self,
        ft: &mut FinalTransaction,
        program_utxo: UTXO,
        first_parameters_nft_utxo: UTXO,
        second_parameters_nft_utxo: UTXO,
        borrower_nft_utxo: UTXO,
        lender_nft_utxo: UTXO,
    ) {
        let first_parameters_nft_amount = first_parameters_nft_utxo.explicit_amount();
        let second_parameters_nft_amount = second_parameters_nft_utxo.explicit_amount();
        let pre_lock_input_index = ft.n_inputs() as u32;

        self.add_program_input_with_signature(
            ft,
            program_utxo,
            PreLockWitnessBranch::PreLockCancellation.build_witness(),
            "SIGNATURE".into(),
        );

        let utility_nfts_script_auth = ScriptAuth::from_simplex_program(self);
        let utility_nfts_witness_params = ScriptAuthWitnessParams::new(pre_lock_input_index);

        utility_nfts_script_auth.use_schema(
            ft,
            ScriptAuthSchema::Unlock {
                program_utxo: first_parameters_nft_utxo,
                witness_params: utility_nfts_witness_params,
            },
        );
        utility_nfts_script_auth.use_schema(
            ft,
            ScriptAuthSchema::Unlock {
                program_utxo: second_parameters_nft_utxo,
                witness_params: utility_nfts_witness_params,
            },
        );
        utility_nfts_script_auth.use_schema(
            ft,
            ScriptAuthSchema::Unlock {
                program_utxo: borrower_nft_utxo,
                witness_params: utility_nfts_witness_params,
            },
        );
        utility_nfts_script_auth.use_schema(
            ft,
            ScriptAuthSchema::Unlock {
                program_utxo: lender_nft_utxo,
                witness_params: utility_nfts_witness_params,
            },
        );

        ft.add_output(PartialOutput::new(
            Script::new_op_return(b"burn"),
            first_parameters_nft_amount,
            self.parameters.first_parameters_nft_asset_id,
        ));

        ft.add_output(PartialOutput::new(
            Script::new_op_return(b"burn"),
            second_parameters_nft_amount,
            self.parameters.second_parameters_nft_asset_id,
        ));

        ft.add_output(PartialOutput::new(
            Script::new_op_return(b"burn"),
            1,
            self.parameters.borrower_nft_asset_id,
        ));

        ft.add_output(PartialOutput::new(
            Script::new_op_return(b"burn"),
            1,
            self.parameters.lender_nft_asset_id,
        ));
    }
}

impl SimplexProgram for PreLock {
    fn get_program(&self) -> &Program {
        self.program.get_program()
    }

    fn get_network(&self) -> &SimplicityNetwork {
        &self.parameters.network
    }
}
