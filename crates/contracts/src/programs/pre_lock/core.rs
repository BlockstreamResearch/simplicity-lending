use simplex::program::Program;

use simplex::provider::{ProviderTrait, SimplicityNetwork};
use simplex::simplicityhl::elements::{
    AssetId, Script, Transaction, hex::ToHex, secp256k1_zkp::XOnlyPublicKey,
};
use simplex::transaction::{FinalTransaction, PartialOutput, UTXO};
use simplex::utils::hash_script;

use crate::artifacts::pre_lock::PreLockProgram;
use crate::programs::lending::Lending;
use crate::programs::pre_lock::{PreLockError, PreLockParameters, PreLockWitnessBranch};
use crate::programs::program::SimplexProgram;
use crate::programs::script_auth::{ScriptAuth, ScriptAuthWitnessParams};
use crate::utils::{FirstNFTParameters, LendingOfferParameters, SecondNFTParameters};

pub struct PreLock {
    program: PreLockProgram,
    parameters: PreLockParameters,
}

pub const PRE_LOCK_CREATION_OP_RETURN_DATA_LENGTH: usize = 64;

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

        let mut op_return_instr_iter = tx.output[5].script_pubkey.instructions_minimal();

        op_return_instr_iter.next();

        let op_return_bytes = op_return_instr_iter
            .next()
            .unwrap()
            .unwrap()
            .push_bytes()
            .unwrap();

        let (borrower_pubkey, principal_asset_id) =
            PreLock::decode_creation_op_return_data(op_return_bytes.to_vec()).unwrap();

        let pre_lock_parameters = PreLockParameters {
            collateral_asset_id,
            principal_asset_id,
            first_parameters_nft_asset_id,
            second_parameters_nft_asset_id,
            borrower_nft_asset_id,
            lender_nft_asset_id,
            offer_parameters,
            borrower_pubkey,
            borrower_output_script_hash: collateral_script_hash,
            network: *provider.get_network(),
        };

        Ok(Self::new(pre_lock_parameters))
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
            "SIGNATURE".into(),
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
        self.program.get_program()
    }

    fn get_network(&self) -> &SimplicityNetwork {
        &self.parameters.network
    }
}
