use simplex::simplicityhl::elements::{AssetId, Script};
use simplex::simplicityhl::elements::{hex::ToHex, schnorr::XOnlyPublicKey};
use simplex::transaction::partial_input::IssuanceInput;
use simplex::transaction::{FinalTransaction, PartialOutput, UTXO};
use simplex::{program::Program, provider::SimplicityNetwork};

use crate::artifacts::issuance_factory::IssuanceFactoryProgram;
use crate::programs::issuance_factory::{
    IssuanceFactoryError, IssuanceFactoryParameters, IssuanceFactoryWitnessBranch,
};
use crate::programs::program::SimplexProgram;

pub struct IssuanceFactory {
    program: IssuanceFactoryProgram,
    parameters: IssuanceFactoryParameters,
}

pub const ISSUANCE_FACTORY_CREATION_OP_RETURN_DATA_LENGTH: usize = 32;

impl IssuanceFactory {
    pub fn new(parameters: IssuanceFactoryParameters) -> Self {
        Self {
            program: IssuanceFactoryProgram::new(parameters.build_arguments()),
            parameters,
        }
    }

    pub fn get_parameters(&self) -> &IssuanceFactoryParameters {
        &self.parameters
    }

    pub fn decode_creation_op_return_data(
        op_return_bytes: Vec<u8>,
    ) -> Result<XOnlyPublicKey, IssuanceFactoryError> {
        if op_return_bytes.len() != ISSUANCE_FACTORY_CREATION_OP_RETURN_DATA_LENGTH {
            return Err(IssuanceFactoryError::InvalidCreationOpReturnDataLength {
                expected: ISSUANCE_FACTORY_CREATION_OP_RETURN_DATA_LENGTH,
                actual: op_return_bytes.len(),
            });
        }

        let owner_pubkey = XOnlyPublicKey::from_slice(op_return_bytes.as_slice())
            .map_err(|_| IssuanceFactoryError::InvalidOpReturnBytes(op_return_bytes.to_hex()))?;

        Ok(owner_pubkey)
    }

    pub fn encode_creation_op_return_data(&self) -> Vec<u8> {
        let mut op_return_data =
            Vec::with_capacity(ISSUANCE_FACTORY_CREATION_OP_RETURN_DATA_LENGTH);
        op_return_data.extend_from_slice(&self.parameters.owner_pubkey.serialize());

        op_return_data
    }

    pub fn attach_creation(
        &self,
        ft: &mut FinalTransaction,
        factory_asset_id: AssetId,
        factory_asset_amount: u64,
    ) {
        self.add_program_output(ft, factory_asset_id, factory_asset_amount);

        let op_return_data = self.encode_creation_op_return_data();

        ft.add_output(PartialOutput::new(
            Script::new_op_return(&op_return_data),
            0,
            AssetId::default(),
        ));
    }

    pub fn attach_assets_issuing(
        &self,
        ft: &mut FinalTransaction,
        program_utxo: UTXO,
        program_issuance_input: IssuanceInput,
    ) {
        let issuance_factory_amount = program_utxo.explicit_amount();
        let issuance_factory_asset = program_utxo.explicit_asset();

        let issuance_factory_output_index = ft.n_outputs() as u32;

        let issuance_factory_witness_branch = IssuanceFactoryWitnessBranch::IssueAssets {
            output_index: issuance_factory_output_index,
        };

        self.add_program_issuance_input_with_signature(
            ft,
            program_utxo,
            program_issuance_input,
            issuance_factory_witness_branch.build_witness(),
            "SIGNATURE".into(),
        );

        self.add_program_output(ft, issuance_factory_asset, issuance_factory_amount);
    }

    pub fn attach_factory_removing(&self, ft: &mut FinalTransaction, program_utxo: UTXO) {
        let issuance_factory_amount = program_utxo.explicit_amount();
        let issuance_factory_asset = program_utxo.explicit_asset();

        let issuance_factory_output_index = ft.n_outputs() as u32;

        let issuance_factory_witness_branch = IssuanceFactoryWitnessBranch::RemoveFactory {
            output_index: issuance_factory_output_index,
        };

        self.add_program_input_with_signature(
            ft,
            program_utxo,
            issuance_factory_witness_branch.build_witness(),
            "SIGNATURE".into(),
        );

        ft.add_output(PartialOutput::new(
            Script::new_op_return(b"burn"),
            issuance_factory_amount,
            issuance_factory_asset,
        ));
    }
}

impl SimplexProgram for IssuanceFactory {
    fn get_program(&self) -> &Program {
        self.program.get_program()
    }

    fn get_network(&self) -> &SimplicityNetwork {
        &self.parameters.network
    }
}
