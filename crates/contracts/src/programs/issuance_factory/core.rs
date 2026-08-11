use simplex::simplicityhl::elements::{AssetId, Script};
use simplex::transaction::partial_input::IssuanceInput;
use simplex::transaction::{
    FinalTransaction, IssuanceDetails, PartialOutput, RequiredSignature, UTXO,
};
use simplex::{program::Program, provider::SimplicityNetwork};

use crate::artifacts::issuance_factory::IssuanceFactoryProgram;
use crate::programs::issuance_factory::{IssuanceFactoryParameters, IssuanceFactoryWitnessBranch};
use crate::programs::program::{MetadataProgram, SimplexProgram};

pub struct IssuanceFactory {
    program: IssuanceFactoryProgram,
    parameters: IssuanceFactoryParameters,
}

impl IssuanceFactory {
    /// Output index of the creation metadata OP_RETURN in a canonical factory creation tx
    /// (auth - 0, program - 1, metadata - 2).
    pub const CREATION_METADATA_OUTPUT_INDEX: usize = 2;

    pub fn new(parameters: IssuanceFactoryParameters) -> Self {
        Self {
            program: IssuanceFactoryProgram::new(&parameters.build_arguments()),
            parameters,
        }
    }

    pub fn get_parameters(&self) -> &IssuanceFactoryParameters {
        &self.parameters
    }

    pub fn attach_creation(
        &self,
        ft: &mut FinalTransaction,
        factory_asset_id: AssetId,
        factory_asset_amount: u64,
    ) {
        self.add_program_output(ft, factory_asset_id, factory_asset_amount);

        let op_return_data = self.encode_metadata_op_return();

        ft.add_output(PartialOutput::new_metadata(&op_return_data));
    }

    pub fn attach_assets_issuance(
        &self,
        ft: &mut FinalTransaction,
        program_utxo: UTXO,
        program_issuance_input: IssuanceInput,
    ) -> IssuanceDetails {
        assert!(
            ft.n_inputs() > 0,
            "Assets issuance cant't be first attachment in transaction"
        );

        let auth_nft_output_index = ft.n_outputs() as u32 - 1;

        let issuance_factory_asset = program_utxo.explicit_asset();

        let issuance_factory_witness_branch = IssuanceFactoryWitnessBranch::IssueAssets {
            output_index: auth_nft_output_index,
        };

        let issuance_details = self.add_program_issuance_input_with_signature(
            ft,
            program_utxo,
            program_issuance_input,
            issuance_factory_witness_branch.build_witness(),
            RequiredSignature::None,
        );

        self.add_program_output(ft, issuance_factory_asset, 1);

        issuance_details
    }

    pub fn attach_factory_removing(&self, ft: &mut FinalTransaction, program_utxo: UTXO) {
        let issuance_factory_asset = program_utxo.explicit_asset();

        let issuance_factory_output_index = ft.n_outputs() as u32;

        let issuance_factory_witness_branch = IssuanceFactoryWitnessBranch::RemoveFactory {
            output_index: issuance_factory_output_index,
        };

        self.add_program_input_with_signature(
            ft,
            program_utxo,
            issuance_factory_witness_branch.build_witness(),
            RequiredSignature::None,
        );

        ft.add_output(PartialOutput::new(
            Script::new_op_return(b"burn"),
            1,
            issuance_factory_asset,
        ));

        ft.add_output(PartialOutput::new(
            Script::new_op_return(b"burn"),
            1,
            issuance_factory_asset,
        ));
    }
}

impl SimplexProgram for IssuanceFactory {
    fn get_program_source_code() -> &'static str {
        IssuanceFactoryProgram::SOURCE
    }

    fn get_program(&self) -> &Program {
        self.program.as_ref()
    }

    fn get_network(&self) -> &SimplicityNetwork {
        &self.parameters.network
    }
}
