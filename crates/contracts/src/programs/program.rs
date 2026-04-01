use simplex::program::{Program, WitnessTrait};
use simplex::provider::SimplicityNetwork;
use simplex::transaction::{
    FinalTransaction, PartialInput, PartialOutput, ProgramInput, RequiredSignature, UTXO,
};

use simplex::simplicityhl::elements::{AssetId, Script};

pub trait SimplexProgram {
    fn add_program_input<'a>(
        &self,
        ft: &'a mut FinalTransaction,
        program_utxo: UTXO,
        witness: Box<dyn WitnessTrait>,
    ) -> Result<&'a mut FinalTransaction, SimplexProgramError> {
        ft.add_program_input(
            PartialInput::new(program_utxo),
            ProgramInput::new(Box::new(self.get_program().clone()), witness),
            RequiredSignature::None,
        )?;

        Ok(ft)
    }

    fn add_program_input_from_partial_input<'a>(
        &self,
        ft: &'a mut FinalTransaction,
        partial_input: PartialInput,
        witness: Box<dyn WitnessTrait>,
    ) -> Result<&'a mut FinalTransaction, SimplexProgramError> {
        ft.add_program_input(
            partial_input,
            ProgramInput::new(Box::new(self.get_program().clone()), witness),
            RequiredSignature::None,
        )?;

        Ok(ft)
    }

    fn add_program_input_with_signature<'a>(
        &self,
        ft: &'a mut FinalTransaction,
        program_utxo: UTXO,
        witness: Box<dyn WitnessTrait>,
        sig_witness_name: String,
    ) -> Result<&'a mut FinalTransaction, SimplexProgramError> {
        ft.add_program_input(
            PartialInput::new(program_utxo),
            ProgramInput::new(Box::new(self.get_program().clone()), witness),
            RequiredSignature::Witness(sig_witness_name),
        )?;

        Ok(ft)
    }

    fn add_program_output<'a>(
        &self,
        ft: &'a mut FinalTransaction,
        asset_id: AssetId,
        asset_amount: u64,
    ) -> Result<&'a mut FinalTransaction, SimplexProgramError> {
        ft.add_output(PartialOutput::new(
            self.get_script_pubkey()?,
            asset_amount,
            asset_id,
        ));

        Ok(ft)
    }

    fn get_script_pubkey(&self) -> Result<Script, SimplexProgramError> {
        let script_pubkey = self.get_program().get_script_pubkey(self.get_network())?;

        Ok(script_pubkey)
    }

    fn get_script_hash(&self) -> Result<[u8; 32], SimplexProgramError> {
        let script_hash = self.get_program().get_script_hash(self.get_network())?;

        Ok(script_hash)
    }

    fn get_program(&self) -> &Program;

    fn get_network(&self) -> &SimplicityNetwork;
}

#[derive(Debug, thiserror::Error)]
pub enum SimplexProgramError {
    #[error("Failed to do program action: {0}")]
    Program(#[from] simplex::program::ProgramError),

    #[error("Failed to do transaction action: {0}")]
    Transaction(#[from] simplex::transaction::TransactionError),
}
