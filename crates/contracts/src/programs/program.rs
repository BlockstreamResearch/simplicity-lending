use ring::digest::{SHA256, digest};
use simplex::program::{Program, WitnessTrait};
use simplex::provider::SimplicityNetwork;
use simplex::transaction::partial_input::IssuanceInput;
use simplex::transaction::{
    FinalTransaction, IssuanceDetails, PartialInput, PartialOutput, ProgramInput,
    RequiredSignature, UTXO,
};

use simplex::simplicityhl::elements::{AssetId, Script, opcodes, script::Instruction};

pub const PROGRAM_ID_LENGTH: usize = 4;
pub type ProgramId = [u8; PROGRAM_ID_LENGTH];

pub fn op_return_payload(script: &Script) -> Option<&[u8]> {
    let mut instructions = script.instructions_minimal();

    match instructions.next()? {
        Ok(Instruction::Op(opcodes::all::OP_RETURN)) => {}
        _ => return None,
    }

    instructions.next()?.ok()?.push_bytes()
}

pub trait CreationOpReturnData: Sized {
    type Error;

    const DATA_LENGTH: usize;

    fn decode(op_return_bytes: &[u8]) -> Result<Self, Self::Error>;

    fn encode(&self) -> Vec<u8>;

    fn validate_length(
        op_return_bytes: &[u8],
        invalid_length: impl FnOnce(usize, usize) -> Self::Error,
    ) -> Result<(), Self::Error> {
        if op_return_bytes.len() != Self::DATA_LENGTH {
            return Err(invalid_length(Self::DATA_LENGTH, op_return_bytes.len()));
        }

        Ok(())
    }

    fn decode_program_id(op_return_bytes: &[u8]) -> ProgramId {
        let mut program_id = [0; PROGRAM_ID_LENGTH];
        program_id.copy_from_slice(&op_return_bytes[..PROGRAM_ID_LENGTH]);

        program_id
    }
}

pub trait SimplexProgram {
    fn add_program_input<'a>(
        &self,
        ft: &'a mut FinalTransaction,
        program_utxo: UTXO,
        witness: Box<dyn WitnessTrait>,
    ) -> &'a mut FinalTransaction {
        ft.add_program_input(
            PartialInput::new(program_utxo),
            ProgramInput::new(Box::new(self.get_program().clone()), witness),
            RequiredSignature::None,
        );

        ft
    }

    fn add_program_input_from_partial_input<'a>(
        &self,
        ft: &'a mut FinalTransaction,
        partial_input: PartialInput,
        witness: Box<dyn WitnessTrait>,
    ) -> &'a mut FinalTransaction {
        ft.add_program_input(
            partial_input,
            ProgramInput::new(Box::new(self.get_program().clone()), witness),
            RequiredSignature::None,
        );

        ft
    }

    fn add_program_input_with_signature<'a>(
        &self,
        ft: &'a mut FinalTransaction,
        program_utxo: UTXO,
        witness: Box<dyn WitnessTrait>,
        required_signature: RequiredSignature,
    ) -> &'a mut FinalTransaction {
        ft.add_program_input(
            PartialInput::new(program_utxo),
            ProgramInput::new(Box::new(self.get_program().clone()), witness),
            required_signature,
        );

        ft
    }

    fn add_program_issuance_input_with_signature(
        &self,
        ft: &mut FinalTransaction,
        program_utxo: UTXO,
        issuance_input: IssuanceInput,
        witness: Box<dyn WitnessTrait>,
        required_signature: RequiredSignature,
    ) -> IssuanceDetails {
        ft.add_program_issuance_input(
            PartialInput::new(program_utxo),
            ProgramInput::new(Box::new(self.get_program().clone()), witness),
            issuance_input,
            required_signature,
        )
    }

    fn add_program_output<'a>(
        &self,
        ft: &'a mut FinalTransaction,
        asset_id: AssetId,
        asset_amount: u64,
    ) -> &'a mut FinalTransaction {
        ft.add_output(PartialOutput::new(
            self.get_script_pubkey(),
            asset_amount,
            asset_id,
        ));

        ft
    }

    fn get_script_pubkey(&self) -> Script {
        self.get_program().get_script_pubkey(self.get_network())
    }

    fn get_script_hash(&self) -> [u8; 32] {
        self.get_program().get_script_hash(self.get_network())
    }

    fn get_program_id(&self) -> ProgramId {
        let source_code_hash = digest(&SHA256, self.get_program_source_code().as_bytes());
        let mut hash_prefix = [0; 4];
        hash_prefix.copy_from_slice(&source_code_hash.as_ref()[..4]);

        hash_prefix
    }

    fn get_program(&self) -> &Program;

    fn get_network(&self) -> &SimplicityNetwork;

    fn get_program_source_code(&self) -> &'static str;
}
