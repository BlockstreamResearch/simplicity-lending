use simplex::program::Program;

use simplex::provider::{ProviderTrait, SimplicityNetwork};
use simplex::simplicityhl::elements::{AssetId, Script, Transaction};
use simplex::transaction::{FinalTransaction, PartialOutput, RequiredSignature, UTXO};
use simplex::utils::hash_script;

use crate::artifacts::pre_lock::PreLockProgram;
use crate::programs::lending::Lending;
use crate::programs::pre_lock::{PreLockError, PreLockParameters, PreLockWitnessBranch};
use crate::programs::program::{SimplexProgram, op_return_payload};
use crate::programs::script_auth::{ScriptAuth, ScriptAuthWitnessParams};
use crate::utils::{FirstNFTParameters, LendingOfferParameters, SecondNFTParameters};

pub struct PreLock {
    program: PreLockProgram,
    parameters: PreLockParameters,
}

pub const UTILITY_NFTS_COUNT: usize = 4;

impl PreLock {
    pub fn new(parameters: PreLockParameters) -> Self {
        Self {
            program: PreLockProgram::new(parameters.build_arguments()),
            parameters,
        }
    }

    pub fn try_from_tx(
        tx: &Transaction,
        provider: &impl ProviderTrait,
    ) -> Result<Self, PreLockError> {
        if tx.input.len() < 5 || tx.output.len() < 7 || !tx.output[5].is_null_data() {
            return Err(PreLockError::NotAPreLockCreationTx(tx.txid()));
        }

        let collateral_asset_id = tx.output[0]
            .asset
            .explicit()
            .ok_or_else(PreLockError::ConfidentialAssetsAreNotSupported)?;
        let first_parameters_nft_asset_id = tx.output[1]
            .asset
            .explicit()
            .expect("Utility NFT must be explicit");
        let second_parameters_nft_asset_id = tx.output[2]
            .asset
            .explicit()
            .expect("Utility NFT must be explicit");
        let borrower_nft_asset_id = tx.output[3]
            .asset
            .explicit()
            .expect("Utility NFT must be explicit");
        let lender_nft_asset_id = tx.output[4]
            .asset
            .explicit()
            .expect("Utility NFT must be explicit");

        let first_parameters_nft_amount = tx.output[1]
            .value
            .explicit()
            .expect("Parameter NFT must have explicit amount");
        let second_parameters_nft_amount = tx.output[2]
            .value
            .explicit()
            .expect("Parameter NFT must have explicit amount");

        let offer_parameters = LendingOfferParameters::build_from_parameters_nfts(
            &FirstNFTParameters::decode(first_parameters_nft_amount),
            &SecondNFTParameters::decode(second_parameters_nft_amount),
        );

        let prev_collateral_outpoint = tx.input[0].previous_output;
        let pre_collateral_tx = provider.fetch_transaction(&prev_collateral_outpoint.txid)?;
        let collateral_script_hash = hash_script(
            &pre_collateral_tx.output[prev_collateral_outpoint.vout as usize].script_pubkey,
        );

        let op_return_bytes = op_return_payload(&tx.output[5].script_pubkey)
            .ok_or_else(|| PreLockError::NotAPreLockCreationTx(tx.txid()))?;

        let creation_op_return_data =
            PreLock::decode_creation_op_return_data(op_return_bytes.to_vec())?;

        let pre_lock_parameters = PreLockParameters {
            collateral_asset_id,
            principal_asset_id: creation_op_return_data.principal_asset_id,
            first_parameters_nft_asset_id,
            second_parameters_nft_asset_id,
            borrower_nft_asset_id,
            lender_nft_asset_id,
            offer_parameters,
            borrower_pubkey: creation_op_return_data.borrower_pubkey,
            borrower_output_script_hash: collateral_script_hash,
            network: *provider.get_network(),
        };

        Ok(Self::new(pre_lock_parameters))
    }

    pub fn get_parameters(&self) -> &PreLockParameters {
        &self.parameters
    }

    pub fn attach_creation(&self, ft: &mut FinalTransaction, parameter_amounts_decimals: u8) {
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

        let utility_nfts_script_auth = ScriptAuth::from_simplex_program(self);
        utility_nfts_script_auth.attach_creation(
            ft,
            self.parameters.first_parameters_nft_asset_id,
            first_parameters_nft_amount,
        );
        utility_nfts_script_auth.attach_creation(
            ft,
            self.parameters.second_parameters_nft_asset_id,
            second_parameters_nft_amount,
        );
        utility_nfts_script_auth.attach_creation(ft, self.parameters.borrower_nft_asset_id, 1);
        utility_nfts_script_auth.attach_creation(ft, self.parameters.lender_nft_asset_id, 1);

        let op_return_data = self.encode_creation_op_return_data();

        ft.add_output(PartialOutput::new(
            Script::new_op_return(&op_return_data),
            0,
            AssetId::default(),
        ));
    }

    pub fn attach_lending_creation(
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

        utility_nfts_script_auth.attach_unlocking(
            ft,
            first_parameters_nft_utxo.clone(),
            utility_nfts_witness_params,
        );
        utility_nfts_script_auth.attach_unlocking(
            ft,
            second_parameters_nft_utxo.clone(),
            utility_nfts_witness_params,
        );
        utility_nfts_script_auth.attach_unlocking(
            ft,
            borrower_nft_utxo,
            utility_nfts_witness_params,
        );
        utility_nfts_script_auth.attach_unlocking(ft, lender_nft_utxo, utility_nfts_witness_params);

        let lending = Lending::new(self.parameters.into());

        lending.attach_creation(ft, first_parameters_nft_utxo, second_parameters_nft_utxo);
    }

    pub fn attach_cancellation(
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
            RequiredSignature::witness_with_path("PATH", &["Right"]),
        );

        let utility_nfts_script_auth = ScriptAuth::from_simplex_program(self);
        let utility_nfts_witness_params = ScriptAuthWitnessParams::new(pre_lock_input_index);

        utility_nfts_script_auth.attach_unlocking(
            ft,
            first_parameters_nft_utxo,
            utility_nfts_witness_params,
        );
        utility_nfts_script_auth.attach_unlocking(
            ft,
            second_parameters_nft_utxo,
            utility_nfts_witness_params,
        );
        utility_nfts_script_auth.attach_unlocking(
            ft,
            borrower_nft_utxo,
            utility_nfts_witness_params,
        );
        utility_nfts_script_auth.attach_unlocking(ft, lender_nft_utxo, utility_nfts_witness_params);

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
        self.program.as_ref()
    }

    fn get_network(&self) -> &SimplicityNetwork {
        &self.parameters.network
    }

    fn get_program_source_code(&self) -> &'static str {
        PreLockProgram::SOURCE
    }
}
