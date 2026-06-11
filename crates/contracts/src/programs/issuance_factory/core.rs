use simplex::simplicityhl::elements::{AssetId, Script, Transaction, Txid};
use simplex::transaction::partial_input::IssuanceInput;
use simplex::transaction::{
    FinalTransaction, IssuanceDetails, PartialOutput, RequiredSignature, UTXO,
};
use simplex::{program::Program, provider::SimplicityNetwork};

use crate::artifacts::issuance_factory::IssuanceFactoryProgram;
use crate::programs::issuance_factory::{
    IssuanceFactoryError, IssuanceFactoryParameters, IssuanceFactoryWitnessBranch,
};
use crate::programs::program::{MetadataProgram, SimplexProgram};
use crate::utils::op_return_payload;

const CREATION_METADATA_OUTPUT_INDEX: usize = 2;

pub struct IssuanceFactory {
    program: IssuanceFactoryProgram,
    parameters: IssuanceFactoryParameters,
}

impl IssuanceFactory {
    pub fn new(parameters: IssuanceFactoryParameters) -> Self {
        Self {
            program: IssuanceFactoryProgram::new(parameters.build_arguments()),
            parameters,
        }
    }

    pub fn try_from_tx(
        tx: &Transaction,
        network: SimplicityNetwork,
    ) -> Result<(Self, AssetId), IssuanceFactoryError> {
        let txid = tx.txid();

        if tx.output.len() <= CREATION_METADATA_OUTPUT_INDEX
            || !tx.output[CREATION_METADATA_OUTPUT_INDEX].is_null_data()
        {
            return Err(IssuanceFactoryError::NotAnIssuanceFactoryCreationTx(txid));
        }

        let op_return_bytes =
            op_return_payload(&tx.output[CREATION_METADATA_OUTPUT_INDEX].script_pubkey)
                .ok_or(IssuanceFactoryError::NotAnIssuanceFactoryCreationTx(txid))?;

        let creation_metadata =
            IssuanceFactory::decode_metadata_op_return(op_return_bytes.to_vec())?;

        if creation_metadata.program_id != Self::get_program_id() {
            return Err(IssuanceFactoryError::NotAnIssuanceFactoryCreationTx(txid));
        }

        let issuance_factory_parameters = IssuanceFactoryParameters {
            issuing_utxos_count: creation_metadata.issuing_utxos_count,
            reissuance_flags: creation_metadata.reissuance_flags,
            network,
        };

        let issuance_factory = Self::new(issuance_factory_parameters);
        let program_script_pubkey = issuance_factory.get_script_pubkey();
        let factory_asset_id = Self::validate_creation_outputs(tx, &program_script_pubkey, txid)?;

        Ok((issuance_factory, factory_asset_id))
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

    fn validate_creation_outputs(
        tx: &Transaction,
        program_script_pubkey: &Script,
        txid: Txid,
    ) -> Result<AssetId, IssuanceFactoryError> {
        let factory_asset_id = tx
            .output
            .iter()
            .filter(|output| output.script_pubkey == *program_script_pubkey)
            .filter_map(|output| {
                let asset_id = output.asset.explicit()?;
                let amount = output.value.explicit()?;
                (amount == 1).then_some(asset_id)
            })
            .collect::<Vec<_>>();

        let &[factory_asset_id] = factory_asset_id.as_slice() else {
            return Err(IssuanceFactoryError::NotAnIssuanceFactoryCreationTx(txid));
        };

        let auth_output_count = tx
            .output
            .iter()
            .filter(|output| {
                let (Some(asset_id), Some(amount)) =
                    (output.asset.explicit(), output.value.explicit())
                else {
                    return false;
                };

                asset_id == factory_asset_id
                    && amount == 1
                    && !output.script_pubkey.is_op_return()
                    && output.script_pubkey != *program_script_pubkey
            })
            .count();

        if auth_output_count != 1 {
            return Err(IssuanceFactoryError::NotAnIssuanceFactoryCreationTx(txid));
        }

        Ok(factory_asset_id)
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
