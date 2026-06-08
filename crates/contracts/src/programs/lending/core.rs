use simplex::{
    program::Program,
    provider::SimplicityNetwork,
    simplicityhl::elements::{AssetId, LockTime, Script, Sequence, Transaction},
    transaction::{FinalTransaction, PartialInput, PartialOutput, UTXO},
};

use crate::{
    artifacts::lending::LendingProgram,
    programs::{
        lending::{
            LendingOfferError, LendingOfferParameters, LendingOfferWitnessBranch, OfferParameters,
            OfferRepaymentPhase,
        },
        program::{MetadataProgram, SimplexProgram},
        script_auth::{ScriptAuth, ScriptAuthWitnessParams},
    },
    utils::op_return_payload,
};

const CREATION_METADATA_OUTPUT_INDEX: usize = 4;

pub struct LendingOfferStorage {
    pub is_active: bool,
    pub current_debt: u64,
}

impl LendingOfferStorage {
    pub fn set_storage_slots(&self, program: &mut LendingProgram) {
        #[allow(unused_must_use)]
        program.set_storage_at(0, self.get_is_active_slot_value());
        #[allow(unused_must_use)]
        program.set_storage_at(1, self.get_current_debt_slot_value());
    }

    fn get_is_active_slot_value(&self) -> [u8; 32] {
        let mut slot = [0u8; 32];
        slot[31] = u8::from(self.is_active);

        slot
    }

    fn get_current_debt_slot_value(&self) -> [u8; 32] {
        let mut slot = [0u8; 32];
        slot[24..32].copy_from_slice(&self.current_debt.to_be_bytes());

        slot
    }
}

pub struct LendingOffer {
    program: LendingProgram,
    parameters: LendingOfferParameters,
    storage: LendingOfferStorage,
}

impl LendingOffer {
    pub fn new_pending(parameters: LendingOfferParameters) -> Self {
        let storage = LendingOfferStorage {
            is_active: false,
            current_debt: parameters.offer_parameters.get_total_amount_to_repay(),
        };

        Self::new(parameters, storage)
    }

    pub fn new_active(parameters: LendingOfferParameters, current_debt: u64) -> Self {
        assert!(
            current_debt <= parameters.offer_parameters.get_total_amount_to_repay(),
            "Current debt can't be higher than the total debt"
        );

        let storage = LendingOfferStorage {
            is_active: true,
            current_debt,
        };

        Self::new(parameters, storage)
    }

    fn new(parameters: LendingOfferParameters, storage: LendingOfferStorage) -> Self {
        let mut lending_offer_program =
            LendingProgram::new(parameters.build_arguments()).with_storage_capacity(2);

        storage.set_storage_slots(&mut lending_offer_program);

        Self {
            program: lending_offer_program,
            parameters,
            storage,
        }
    }

    pub fn try_from_tx(
        tx: &Transaction,
        protocol_fee_keeper_asset_id: AssetId,
        network: SimplicityNetwork,
    ) -> Result<Self, LendingOfferError> {
        if tx.output.len() <= 6 || !tx.output[CREATION_METADATA_OUTPUT_INDEX].is_null_data() {
            return Err(LendingOfferError::NotALendingOfferCreationTx(tx.txid()));
        }

        let op_return_bytes =
            op_return_payload(&tx.output[CREATION_METADATA_OUTPUT_INDEX].script_pubkey)
                .ok_or_else(|| LendingOfferError::NotALendingOfferCreationTx(tx.txid()))?;

        let creation_metadata = LendingOffer::decode_metadata_op_return(op_return_bytes.to_vec())?;

        if creation_metadata.program_id != Self::get_program_id() {
            return Err(LendingOfferError::NotALendingOfferCreationTx(tx.txid()));
        }

        let borrower_nft_tx_out = tx.output[2].clone();
        let lender_nft_tx_out = tx.output[3].clone();
        let pending_offer_tx_out = tx.output[5].clone();

        let offer_parameters = OfferParameters {
            collateral_amount: pending_offer_tx_out.value.explicit().unwrap(),
            principal_amount: creation_metadata.principal_amount,
            loan_expiration_time: creation_metadata.loan_expiration_time,
            principal_interest_rate: creation_metadata.principal_interest_rate,
        };

        let offer_parameters = LendingOfferParameters {
            collateral_asset_id: pending_offer_tx_out.asset.explicit().unwrap(),
            principal_asset_id: creation_metadata.principal_asset_id,
            protocol_fee_keeper_asset_id,
            borrower_nft_asset_id: borrower_nft_tx_out.asset.explicit().unwrap(),
            lender_nft_asset_id: lender_nft_tx_out.asset.explicit().unwrap(),
            offer_parameters,
            network,
        };

        Ok(Self::new_pending(offer_parameters))
    }

    pub fn get_parameters(&self) -> &LendingOfferParameters {
        &self.parameters
    }

    pub fn is_active_offer(&self) -> bool {
        self.storage.is_active
    }

    pub fn is_pending_offer(&self) -> bool {
        !self.storage.is_active
    }

    pub fn get_current_debt(&self) -> u64 {
        self.storage.current_debt
    }

    pub fn attach_creation(&self, ft: &mut FinalTransaction) {
        if self.is_pending_offer() {
            let lender_nft_script_auth = ScriptAuth::from_simplex_program(self);

            lender_nft_script_auth.attach_creation(ft, self.parameters.lender_nft_asset_id, 1);

            let creation_metadata = self.encode_metadata_op_return();

            ft.add_output(PartialOutput::new_metadata(&creation_metadata));
        }

        self.add_program_output(
            ft,
            self.parameters.collateral_asset_id,
            self.parameters.offer_parameters.collateral_amount,
        );
    }

    pub fn attach_acceptance(
        &mut self,
        ft: &mut FinalTransaction,
        pending_offer_utxo: UTXO,
        lender_nft_utxo: UTXO,
    ) {
        let pending_offer_input_index = ft.n_inputs() as u32;

        self.add_program_input(
            ft,
            pending_offer_utxo,
            LendingOfferWitnessBranch::OfferAcceptance.build_witness(),
        );

        self.attach_lender_nft_unlocking(ft, lender_nft_utxo, pending_offer_input_index);

        self.update_offer_status(true);

        self.attach_creation(ft);

        let principal_output_asset_auth = self.parameters.get_principal_output_asset_auth();

        principal_output_asset_auth.attach_creation(
            ft,
            self.parameters.principal_asset_id,
            self.parameters.offer_parameters.principal_amount,
        );
    }

    pub fn attach_cancellation(
        &self,
        ft: &mut FinalTransaction,
        pending_offer_utxo: UTXO,
        lender_nft_utxo: UTXO,
    ) {
        let pending_offer_input_index = ft.n_inputs() as u32;

        self.add_program_input(
            ft,
            pending_offer_utxo,
            LendingOfferWitnessBranch::OfferCancellation.build_witness(),
        );

        self.attach_lender_nft_unlocking(ft, lender_nft_utxo, pending_offer_input_index);

        ft.add_output(PartialOutput::new(
            Script::new_op_return(b"burn"),
            1,
            self.parameters.lender_nft_asset_id,
        ));

        ft.add_output(PartialOutput::new(
            Script::new_op_return(b"burn"),
            1,
            self.parameters.borrower_nft_asset_id,
        ));
    }

    pub fn attach_full_repayment(
        &mut self,
        ft: &mut FinalTransaction,
        active_offer_utxo: UTXO,
        lender_vault_utxo: Option<UTXO>,
        protocol_fee_vault_utxo: Option<UTXO>,
    ) {
        self.attach_partial_repayment(
            ft,
            active_offer_utxo,
            lender_vault_utxo,
            protocol_fee_vault_utxo,
            self.get_current_debt(),
        );
    }

    pub fn attach_partial_repayment(
        &mut self,
        ft: &mut FinalTransaction,
        active_offer_utxo: UTXO,
        lender_vault_utxo: Option<UTXO>,
        protocol_fee_vault_utxo: Option<UTXO>,
        amount_to_repay: u64,
    ) {
        assert!(
            ft.n_inputs() > 0,
            "Repayment cant't be first attachment in transaction"
        );

        let current_debt = self.get_current_debt();

        assert!(amount_to_repay <= current_debt, "Invalid repayment amount");

        let is_final_repayment = current_debt == amount_to_repay;

        let witness_branch = if is_final_repayment {
            LendingOfferWitnessBranch::FullRepayment { current_debt }
        } else {
            LendingOfferWitnessBranch::PartialRepayment {
                current_debt,
                amount_to_repay,
            }
        };

        let borrower_nft_input_index = ft.n_inputs() as u32 - 1;
        let borrower_nft_output_index = if is_final_repayment {
            let output_index = ft.n_outputs() as u32;

            ft.add_output(PartialOutput::new(
                Script::new_op_return(b"burn"),
                1,
                self.parameters.borrower_nft_asset_id,
            ));

            output_index
        } else {
            (ft.n_outputs() as u32)
                .checked_sub(1)
                .expect("Unable to find borrower nft output index")
        };

        self.add_program_input(ft, active_offer_utxo, witness_branch.build_witness());

        self.update_offer_debt(current_debt - amount_to_repay);

        if amount_to_repay < current_debt {
            self.add_program_output(
                ft,
                self.parameters.collateral_asset_id,
                self.parameters.offer_parameters.collateral_amount,
            );
        }

        self.attach_vaults(
            ft,
            lender_vault_utxo,
            protocol_fee_vault_utxo,
            (borrower_nft_input_index, borrower_nft_output_index),
            current_debt,
            amount_to_repay,
        );
    }

    pub fn attach_liquidation(&self, ft: &mut FinalTransaction, active_offer_utxo: UTXO) {
        let current_debt = self.get_current_debt();

        let locktime =
            LockTime::from_height(self.parameters.offer_parameters.loan_expiration_time).unwrap();

        let active_offer_input = PartialInput::new(active_offer_utxo)
            .with_sequence(Sequence::ENABLE_LOCKTIME_NO_RBF)
            .with_locktime(locktime);

        self.add_program_input_from_partial_input(
            ft,
            active_offer_input,
            LendingOfferWitnessBranch::Liquidation { current_debt }.build_witness(),
        );

        ft.add_output(PartialOutput::new(
            Script::new_op_return(b"burn"),
            1,
            self.parameters.lender_nft_asset_id,
        ));
    }

    fn attach_lender_nft_unlocking(
        &self,
        ft: &mut FinalTransaction,
        lender_nft_utxo: UTXO,
        pending_offer_input_index: u32,
    ) {
        let lender_nft_script_auth = ScriptAuth::from_simplex_program(self);
        let lender_nft_witness_params = ScriptAuthWitnessParams::new(pending_offer_input_index);

        lender_nft_script_auth.attach_unlocking(ft, lender_nft_utxo, lender_nft_witness_params);
    }

    fn attach_vaults(
        &self,
        ft: &mut FinalTransaction,
        lender_vault_utxo: Option<UTXO>,
        protocol_fee_vault_utxo: Option<UTXO>,
        borrower_nft_indexes: (u32, u32),
        current_borrower_debt: u64,
        amount_to_repay: u64,
    ) {
        match self
            .parameters
            .offer_parameters
            .get_repayment_phase(current_borrower_debt)
        {
            OfferRepaymentPhase::NoRepayments => {
                self.attach_vaults_for_no_repayments_phase(
                    ft,
                    current_borrower_debt,
                    amount_to_repay,
                );
            }
            OfferRepaymentPhase::RepayingOfferFee => {
                self.attach_vaults_for_repaying_offer_fee_phase(
                    ft,
                    lender_vault_utxo.unwrap(),
                    protocol_fee_vault_utxo.unwrap(),
                    borrower_nft_indexes,
                    current_borrower_debt,
                    amount_to_repay,
                );
            }
            OfferRepaymentPhase::RepayingPrincipal => {
                self.attach_vaults_for_repaying_principal_phase(
                    ft,
                    lender_vault_utxo.unwrap(),
                    borrower_nft_indexes,
                    current_borrower_debt,
                    amount_to_repay,
                );
            }
            OfferRepaymentPhase::Repaid => {}
        }
    }

    fn attach_vaults_for_no_repayments_phase(
        &self,
        ft: &mut FinalTransaction,
        current_borrower_debt: u64,
        amount_to_repay: u64,
    ) {
        let repaid_protocol_fee = self
            .parameters
            .offer_parameters
            .get_repaid_protocol_fee(current_borrower_debt, amount_to_repay);

        if amount_to_repay < current_borrower_debt {
            self.parameters
                .get_active_lender_vault()
                .attach_creation(ft, amount_to_repay - repaid_protocol_fee);
        } else {
            self.parameters
                .get_finalized_lender_vault()
                .attach_creation(ft, amount_to_repay - repaid_protocol_fee);
        }

        if repaid_protocol_fee < self.parameters.offer_parameters.get_total_protocol_fee() {
            self.parameters
                .get_active_protocol_fee_vault()
                .attach_creation(ft, repaid_protocol_fee);
        } else {
            self.parameters
                .get_finalized_protocol_fee_vault()
                .attach_creation(ft, repaid_protocol_fee);
        }
    }

    fn attach_vaults_for_repaying_offer_fee_phase(
        &self,
        ft: &mut FinalTransaction,
        lender_vault_utxo: UTXO,
        protocol_fee_vault_utxo: UTXO,
        borrower_debt_nft_indexes: (u32, u32),
        current_borrower_debt: u64,
        amount_to_repay: u64,
    ) {
        let repaid_protocol_fee = self
            .parameters
            .offer_parameters
            .get_repaid_protocol_fee(current_borrower_debt, amount_to_repay);
        let protocol_fee_left = self
            .parameters
            .offer_parameters
            .get_protocol_fee_to_repay(current_borrower_debt);

        let active_lender_vault = self.parameters.get_active_lender_vault();
        let active_protocol_fee_vault = self.parameters.get_active_protocol_fee_vault();

        active_lender_vault.attach_supplying_with_goal(
            ft,
            lender_vault_utxo,
            borrower_debt_nft_indexes.0,
            borrower_debt_nft_indexes.1,
            amount_to_repay - repaid_protocol_fee,
            current_borrower_debt - protocol_fee_left,
        );

        active_protocol_fee_vault.attach_supplying_with_goal(
            ft,
            protocol_fee_vault_utxo,
            borrower_debt_nft_indexes.0,
            borrower_debt_nft_indexes.1,
            repaid_protocol_fee,
            protocol_fee_left,
        );
    }

    fn attach_vaults_for_repaying_principal_phase(
        &self,
        ft: &mut FinalTransaction,
        lender_vault_utxo: UTXO,
        borrower_debt_nft_indexes: (u32, u32),
        current_borrower_debt: u64,
        amount_to_repay: u64,
    ) {
        let active_lender_vault = self.parameters.get_active_lender_vault();

        active_lender_vault.attach_supplying_with_goal(
            ft,
            lender_vault_utxo,
            borrower_debt_nft_indexes.0,
            borrower_debt_nft_indexes.1,
            amount_to_repay,
            current_borrower_debt,
        );
    }

    fn update_offer_status(&mut self, new_status: bool) {
        self.storage.is_active = new_status;
        self.storage.set_storage_slots(&mut self.program);
    }

    fn update_offer_debt(&mut self, new_debt: u64) {
        self.storage.current_debt = new_debt;
        self.storage.set_storage_slots(&mut self.program);
    }
}

impl SimplexProgram for LendingOffer {
    fn get_program_source_code() -> &'static str {
        LendingProgram::SOURCE
    }

    fn get_program(&self) -> &Program {
        self.program.as_ref()
    }

    fn get_network(&self) -> &SimplicityNetwork {
        &self.parameters.network
    }
}
