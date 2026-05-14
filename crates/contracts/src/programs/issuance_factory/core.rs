use simplex::provider::ProviderTrait;
use simplex::simplicityhl::elements::{AssetId, Script, Transaction};
use simplex::simplicityhl::elements::{hex::ToHex, schnorr::XOnlyPublicKey};
use simplex::transaction::partial_input::IssuanceInput;
use simplex::transaction::{
    FinalTransaction, IssuanceDetails, PartialOutput, RequiredSignature, UTXO,
};
use simplex::{program::Program, provider::SimplicityNetwork};

use crate::artifacts::issuance_factory::IssuanceFactoryProgram;
use crate::programs::issuance_factory::{
    IssuanceFactoryError, IssuanceFactoryParameters, IssuanceFactoryWitnessBranch,
};
use crate::programs::program::{
    CreationOpReturnData, PROGRAM_ID_LENGTH, ProgramId, SimplexProgram, op_return_payload,
};

pub struct IssuanceFactory {
    program: IssuanceFactoryProgram,
    parameters: IssuanceFactoryParameters,
}

const CREATION_OP_RETURN_OUTPUT_INDEX: usize = 1;
const OWNER_PUBKEY_LENGTH: usize = 32;
const CREATION_OP_RETURN_DATA_LENGTH: usize = PROGRAM_ID_LENGTH
    + std::mem::size_of::<u8>()
    + std::mem::size_of::<u64>()
    + OWNER_PUBKEY_LENGTH;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IssuanceFactoryCreationOpReturnData {
    pub program_id: ProgramId,
    pub issuing_utxos_count: u8,
    pub reissuance_flags: u64,
    pub owner_pubkey: XOnlyPublicKey,
}

impl IssuanceFactoryCreationOpReturnData {
    pub fn new(
        program_id: ProgramId,
        issuing_utxos_count: u8,
        reissuance_flags: u64,
        owner_pubkey: XOnlyPublicKey,
    ) -> Self {
        Self {
            program_id,
            issuing_utxos_count,
            reissuance_flags,
            owner_pubkey,
        }
    }

    pub fn decode(op_return_bytes: &[u8]) -> Result<Self, IssuanceFactoryError> {
        <Self as CreationOpReturnData>::decode(op_return_bytes)
    }

    pub fn encode(&self) -> Vec<u8> {
        <Self as CreationOpReturnData>::encode(self)
    }
}

impl CreationOpReturnData for IssuanceFactoryCreationOpReturnData {
    type Error = IssuanceFactoryError;

    const DATA_LENGTH: usize = CREATION_OP_RETURN_DATA_LENGTH;

    fn decode(op_return_bytes: &[u8]) -> Result<Self, Self::Error> {
        Self::validate_length(op_return_bytes, |expected, actual| {
            IssuanceFactoryError::InvalidCreationOpReturnDataLength { expected, actual }
        })?;

        let mut cursor = 0;

        let program_id = Self::decode_program_id(op_return_bytes);
        cursor += PROGRAM_ID_LENGTH;

        let issuing_utxos_count = op_return_bytes[cursor];
        cursor += std::mem::size_of::<u8>();

        let reissuance_flags = u64::from_le_bytes(
            op_return_bytes[cursor..cursor + std::mem::size_of::<u64>()]
                .try_into()
                .expect("reissuance flags length is fixed"),
        );
        cursor += std::mem::size_of::<u64>();

        let owner_pubkey_bytes = &op_return_bytes[cursor..];
        let owner_pubkey = XOnlyPublicKey::from_slice(owner_pubkey_bytes)
            .map_err(|_| IssuanceFactoryError::InvalidOpReturnBytes(op_return_bytes.to_hex()))?;

        Ok(Self {
            program_id,
            issuing_utxos_count,
            reissuance_flags,
            owner_pubkey,
        })
    }

    fn encode(&self) -> Vec<u8> {
        let mut op_return_data = Vec::with_capacity(Self::DATA_LENGTH);
        op_return_data.extend_from_slice(&self.program_id);
        op_return_data.push(self.issuing_utxos_count);
        op_return_data.extend_from_slice(&self.reissuance_flags.to_le_bytes());
        op_return_data.extend_from_slice(&self.owner_pubkey.serialize());

        op_return_data
    }
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
        provider: &impl ProviderTrait,
    ) -> Result<Self, IssuanceFactoryError> {
        if tx.output.len() <= CREATION_OP_RETURN_OUTPUT_INDEX
            || !tx.output[CREATION_OP_RETURN_OUTPUT_INDEX].is_null_data()
        {
            return Err(IssuanceFactoryError::NotAnIssuanceFactoryCreationTx(
                tx.txid(),
            ));
        }

        let op_return_bytes =
            op_return_payload(&tx.output[CREATION_OP_RETURN_OUTPUT_INDEX].script_pubkey)
                .ok_or_else(|| IssuanceFactoryError::NotAnIssuanceFactoryCreationTx(tx.txid()))?;

        let creation_op_return_data =
            IssuanceFactory::decode_creation_op_return_data(op_return_bytes.to_vec())?;

        let issuance_factory_parameters = IssuanceFactoryParameters {
            issuing_utxos_count: creation_op_return_data.issuing_utxos_count,
            reissuance_flags: creation_op_return_data.reissuance_flags,
            owner_pubkey: creation_op_return_data.owner_pubkey,
            network: *provider.get_network(),
        };

        Ok(Self::new(issuance_factory_parameters))
    }

    pub fn get_parameters(&self) -> &IssuanceFactoryParameters {
        &self.parameters
    }

    pub fn decode_creation_op_return_data(
        op_return_bytes: Vec<u8>,
    ) -> Result<IssuanceFactoryCreationOpReturnData, IssuanceFactoryError> {
        IssuanceFactoryCreationOpReturnData::decode(&op_return_bytes)
    }

    pub fn encode_creation_op_return_data(&self) -> Vec<u8> {
        IssuanceFactoryCreationOpReturnData::new(
            self.get_program_id(),
            self.parameters.issuing_utxos_count,
            self.parameters.reissuance_flags,
            self.parameters.owner_pubkey,
        )
        .encode()
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
    ) -> IssuanceDetails {
        let issuance_factory_amount = program_utxo.explicit_amount();
        let issuance_factory_asset = program_utxo.explicit_asset();

        let issuance_factory_output_index = ft.n_outputs() as u32;

        let issuance_factory_witness_branch = IssuanceFactoryWitnessBranch::IssueAssets {
            output_index: issuance_factory_output_index,
        };

        let issuance_details = self.add_program_issuance_input_with_signature(
            ft,
            program_utxo,
            program_issuance_input,
            issuance_factory_witness_branch.build_witness(),
            RequiredSignature::witness_with_path("PATH", &["Left", "1"]),
        );

        self.add_program_output(ft, issuance_factory_asset, issuance_factory_amount);

        issuance_details
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
            RequiredSignature::witness_with_path("PATH", &["Right", "1"]),
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
        self.program.as_ref()
    }

    fn get_network(&self) -> &SimplicityNetwork {
        &self.parameters.network
    }

    fn get_program_source_code(&self) -> &'static str {
        IssuanceFactoryProgram::SOURCE
    }
}
