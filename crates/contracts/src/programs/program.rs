use simplex::program::{Program, WitnessTrait};
use simplex::provider::SimplicityNetwork;
use simplex::transaction::partial_input::IssuanceInput;
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
        sig_witness_name: String,
    ) -> &'a mut FinalTransaction {
        ft.add_program_input(
            PartialInput::new(program_utxo),
            ProgramInput::new(Box::new(self.get_program().clone()), witness),
            RequiredSignature::Witness(sig_witness_name),
        );

        ft
    }

    fn add_program_issuance_input_with_signature(
        &self,
        ft: &mut FinalTransaction,
        program_utxo: UTXO,
        issuance_input: IssuanceInput,
        witness: Box<dyn WitnessTrait>,
        sig_witness_name: String,
    ) -> AssetId {
        let (asset_id, _) = ft.add_program_issuance_input(
            PartialInput::new(program_utxo),
            ProgramInput::new(Box::new(self.get_program().clone()), witness),
            issuance_input,
            RequiredSignature::Witness(sig_witness_name),
        );

        asset_id
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

    fn get_program(&self) -> &Program;

    fn get_network(&self) -> &SimplicityNetwork;
}
