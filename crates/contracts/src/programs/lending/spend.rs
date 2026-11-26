use simplex::simplicityhl::elements::Transaction;

use crate::programs::lending::{
    LendingOffer, LendingOfferAcceptanceScan, LendingOfferCancellationScan, LendingOfferError,
    LendingOfferLiquidationScan, LendingOfferRepaymentScan,
};

/// What a transaction spending a lending offer UTXO did to the offer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LendingOfferSpend {
    Acceptance(LendingOfferAcceptanceScan),
    Cancellation(LendingOfferCancellationScan),
    PartialRepayment(LendingOfferRepaymentScan),
    FullRepayment(LendingOfferRepaymentScan),
    Liquidation(LendingOfferLiquidationScan),
}

impl LendingOffer {
    /// Classify a transaction that spends this offer's UTXO at `input_index`.
    ///
    /// Only inputs and outputs whose position the covenant pins are inspected, so whatever a
    /// spender adds at other positions can't change the result. Every covenant-valid spend is
    /// classified; an error means the transaction isn't one.
    ///
    /// `vault_amounts_before` is `(lender_vault_amount, protocol_fee_vault_amount)` from the
    /// spent vault UTXOs. Partial repayments after the first one need it to recover the repaid
    /// amount; see [`Self::discover_partial_repayment`].
    pub fn classify_spend(
        &self,
        tx: &Transaction,
        input_index: u32,
        vault_amounts_before: Option<(u64, Option<u64>)>,
    ) -> Result<LendingOfferSpend, LendingOfferError> {
        let spend = if self.is_pending_offer() {
            self.classify_pending_offer_spend(tx, input_index)
        } else {
            self.classify_active_offer_spend(tx, input_index, vault_amounts_before)
        };

        spend.ok_or_else(|| LendingOfferError::UnclassifiedSpend {
            txid: tx.txid(),
            input_index,
        })
    }

    fn classify_pending_offer_spend(
        &self,
        tx: &Transaction,
        input_index: u32,
    ) -> Option<LendingOfferSpend> {
        if input_index != Self::PENDING_OFFER_SPEND_INPUT_INDEX {
            return None;
        }

        if let Some(scan) = self.scan_cancellation(tx) {
            return Some(LendingOfferSpend::Cancellation(scan));
        }

        self.scan_acceptance(tx).map(LendingOfferSpend::Acceptance)
    }

    fn classify_active_offer_spend(
        &self,
        tx: &Transaction,
        input_index: u32,
        vault_amounts_before: Option<(u64, Option<u64>)>,
    ) -> Option<LendingOfferSpend> {
        match input_index {
            Self::LIQUIDATION_OFFER_INPUT_INDEX => self
                .scan_liquidation(tx)
                .map(LendingOfferSpend::Liquidation),
            Self::REPAYMENT_OFFER_INPUT_INDEX => {
                let borrower_nft_input = Self::REPAYMENT_BORROWER_NFT_INPUT_INDEX;
                let borrower_nft_output = Self::REPAYMENT_BORROWER_NFT_OUTPUT_INDEX;

                if let Some(scan) =
                    self.scan_full_repayment(tx, borrower_nft_input, borrower_nft_output)
                {
                    return Some(LendingOfferSpend::FullRepayment(scan));
                }

                self.discover_partial_repayment(
                    tx,
                    borrower_nft_input,
                    borrower_nft_output,
                    vault_amounts_before,
                )
                .map(LendingOfferSpend::PartialRepayment)
            }
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::LendingOfferSpend;
    use crate::programs::asset_auth_vault::AssetAuthVault;
    use crate::programs::lending::{LendingOffer, LendingOfferParameters, OfferParameters};
    use crate::programs::program::SimplexProgram;
    use crate::programs::script_auth::ScriptAuth;
    use simplex::{
        provider::SimplicityNetwork,
        simplicityhl::elements::{
            AssetId, LockTime, Script, Transaction, TxIn, TxOut, confidential,
        },
    };

    fn asset(byte: u8) -> AssetId {
        AssetId::from_byte_array([byte; 32])
    }

    fn script(bytes: &[u8]) -> Script {
        Script::from(bytes.to_vec())
    }

    fn explicit_output(asset_id: AssetId, amount: u64, script_pubkey: Script) -> TxOut {
        let mut output = TxOut {
            script_pubkey,
            ..Default::default()
        };
        output.asset = confidential::Asset::Explicit(asset_id);
        output.value = confidential::Value::Explicit(amount);
        output
    }

    fn op_return(asset_id: AssetId, amount: u64) -> TxOut {
        explicit_output(asset_id, amount, Script::new_op_return(b"burn"))
    }

    fn tx_with_outputs(outputs: Vec<TxOut>) -> Transaction {
        Transaction {
            version: 2,
            lock_time: LockTime::ZERO,
            input: vec![TxIn::default(); 4],
            output: outputs,
        }
    }

    fn test_params() -> LendingOfferParameters {
        LendingOfferParameters {
            collateral_asset_id: asset(1),
            principal_asset_id: asset(2),
            borrower_nft_asset_id: asset(3),
            lender_nft_asset_id: asset(4),
            protocol_fee_keeper_asset_id: asset(5),
            offer_parameters: OfferParameters {
                collateral_amount: 3_000,
                principal_amount: 10_000,
                loan_expiration_time: 12_345,
                principal_interest_rate: 1_000,
            },
            network: SimplicityNetwork::default_regtest(),
        }
    }

    fn total_debt(params: &LendingOfferParameters) -> u64 {
        params.offer_parameters.get_total_amount_to_repay()
    }

    /// Outputs a spender may add at positions the covenant leaves free: a junk OP_RETURN and
    /// dust at every program script involved in the offer.
    fn junk_outputs(params: &LendingOfferParameters, debt_after: Option<u64>) -> Vec<TxOut> {
        let pending = LendingOffer::new_pending(*params);
        let active = LendingOffer::new_active(*params, total_debt(params));
        let mut outputs = vec![
            op_return(params.collateral_asset_id, 0),
            explicit_output(params.collateral_asset_id, 1, pending.get_script_pubkey()),
            explicit_output(params.collateral_asset_id, 1, active.get_script_pubkey()),
            explicit_output(
                params.collateral_asset_id,
                1,
                ScriptAuth::from_simplex_program(&pending).get_script_pubkey(),
            ),
            explicit_output(
                params.principal_asset_id,
                params.offer_parameters.principal_amount,
                params.get_principal_output_asset_auth().get_script_pubkey(),
            ),
        ];
        if let Some(debt_after) = debt_after {
            let continuing = LendingOffer::new_active(*params, debt_after);
            outputs.push(explicit_output(
                params.collateral_asset_id,
                1,
                continuing.get_script_pubkey(),
            ));
        }
        outputs
    }

    fn cancellation_outputs(params: &LendingOfferParameters) -> Vec<TxOut> {
        vec![
            op_return(params.lender_nft_asset_id, 1),
            op_return(params.borrower_nft_asset_id, 1),
            explicit_output(params.collateral_asset_id, 3_000, script(&[0x51])),
        ]
    }

    fn acceptance_outputs(params: &LendingOfferParameters) -> Vec<TxOut> {
        let active = LendingOffer::new_active(*params, total_debt(params));

        vec![
            explicit_output(
                params.collateral_asset_id,
                params.offer_parameters.collateral_amount,
                active.get_script_pubkey(),
            ),
            explicit_output(
                params.principal_asset_id,
                params.offer_parameters.principal_amount,
                params.get_principal_output_asset_auth().get_script_pubkey(),
            ),
            explicit_output(params.lender_nft_asset_id, 1, script(&[0x52])),
        ]
    }

    fn full_repayment_outputs(params: &LendingOfferParameters) -> Vec<TxOut> {
        let total = total_debt(params);
        let protocol_fee = params.offer_parameters.get_total_protocol_fee();
        let lender_vault = AssetAuthVault::new_finalized(params.get_lender_vault_parameters());
        let protocol_vault =
            AssetAuthVault::new_finalized(params.get_protocol_fee_vault_parameters());

        vec![
            op_return(params.borrower_nft_asset_id, 1),
            explicit_output(
                params.principal_asset_id,
                total - protocol_fee,
                lender_vault.get_script_pubkey(),
            ),
            explicit_output(
                params.principal_asset_id,
                protocol_fee,
                protocol_vault.get_script_pubkey(),
            ),
        ]
    }

    /// First partial repayment of 500 out of the total debt.
    fn first_partial_repayment_outputs(params: &LendingOfferParameters) -> (Vec<TxOut>, u64) {
        let total = total_debt(params);
        let amount_to_repay = 500;
        let debt_after = total - amount_to_repay;
        let continuing = LendingOffer::new_active(*params, debt_after);

        let protocol_fee = params
            .offer_parameters
            .get_repaid_protocol_fee(total, amount_to_repay);
        let lender_amount = amount_to_repay - protocol_fee;
        let lender_vault =
            AssetAuthVault::new_active(params.get_lender_vault_parameters(), lender_amount);
        let protocol_vault =
            AssetAuthVault::new_active(params.get_protocol_fee_vault_parameters(), protocol_fee);

        let outputs = vec![
            explicit_output(params.borrower_nft_asset_id, 1, script(&[0x51])),
            explicit_output(
                params.collateral_asset_id,
                3_000
                    - params
                        .offer_parameters
                        .get_collateral_for_principal(amount_to_repay),
                continuing.get_script_pubkey(),
            ),
            explicit_output(
                params.principal_asset_id,
                lender_amount,
                lender_vault.get_script_pubkey(),
            ),
            explicit_output(
                params.principal_asset_id,
                protocol_fee,
                protocol_vault.get_script_pubkey(),
            ),
        ];

        (outputs, debt_after)
    }

    fn liquidation_outputs(params: &LendingOfferParameters) -> Vec<TxOut> {
        vec![
            op_return(params.lender_nft_asset_id, 1),
            explicit_output(params.collateral_asset_id, 3_000, script(&[0x51])),
        ]
    }

    #[test]
    fn classifies_cancellation() {
        let params = test_params();
        let pending = LendingOffer::new_pending(params);
        let tx = tx_with_outputs(cancellation_outputs(&params));

        let spend = pending.classify_spend(&tx, 0, None).unwrap();

        let LendingOfferSpend::Cancellation(scan) = spend else {
            panic!("expected cancellation, got {spend:?}");
        };
        assert_eq!(scan.lender_nft_burn_vout, 0);
        assert_eq!(scan.borrower_nft_burn_vout, 1);
    }

    #[test]
    fn classifies_cancellation_with_junk_op_return_before_collateral() {
        let params = test_params();
        let pending = LendingOffer::new_pending(params);
        let mut outputs = cancellation_outputs(&params);
        outputs.insert(2, op_return(params.collateral_asset_id, 0));
        let tx = tx_with_outputs(outputs);

        let spend = pending.classify_spend(&tx, 0, None).unwrap();

        assert!(matches!(spend, LendingOfferSpend::Cancellation(_)));
    }

    #[test]
    fn classifies_cancellation_with_junk_outputs() {
        let params = test_params();
        let pending = LendingOffer::new_pending(params);
        let mut outputs = cancellation_outputs(&params);
        outputs.extend(junk_outputs(&params, None));
        let tx = tx_with_outputs(outputs);

        let spend = pending.classify_spend(&tx, 0, None).unwrap();

        assert!(matches!(spend, LendingOfferSpend::Cancellation(_)));
    }

    #[test]
    fn classifies_acceptance_with_junk_outputs() {
        let params = test_params();
        let pending = LendingOffer::new_pending(params);
        let mut outputs = acceptance_outputs(&params);
        outputs.extend(junk_outputs(&params, None));
        let tx = tx_with_outputs(outputs);

        let spend = pending.classify_spend(&tx, 0, None).unwrap();

        let LendingOfferSpend::Acceptance(scan) = spend else {
            panic!("expected acceptance, got {spend:?}");
        };
        assert_eq!(scan.active_offer_vout, 0);
        assert_eq!(scan.borrower_principal_vout, 1);
        assert_eq!(scan.collateral_amount, 3_000);
    }

    #[test]
    fn rejects_pending_offer_spent_from_other_input() {
        let params = test_params();
        let pending = LendingOffer::new_pending(params);
        let tx = tx_with_outputs(cancellation_outputs(&params));

        assert!(pending.classify_spend(&tx, 1, None).is_err());
    }

    #[test]
    fn rejects_acceptance_with_wrong_principal_amount() {
        let params = test_params();
        let pending = LendingOffer::new_pending(params);
        let mut outputs = acceptance_outputs(&params);
        outputs[1] = explicit_output(
            params.principal_asset_id,
            params.offer_parameters.principal_amount - 1,
            params.get_principal_output_asset_auth().get_script_pubkey(),
        );
        let tx = tx_with_outputs(outputs);

        assert!(pending.classify_spend(&tx, 0, None).is_err());
    }

    #[test]
    fn rejects_swapped_nft_burns() {
        let params = test_params();
        let pending = LendingOffer::new_pending(params);
        let mut outputs = cancellation_outputs(&params);
        outputs.swap(0, 1);
        let tx = tx_with_outputs(outputs);

        assert!(pending.classify_spend(&tx, 0, None).is_err());
    }

    #[test]
    fn classifies_full_repayment_with_junk_outputs() {
        let params = test_params();
        let total = total_debt(&params);
        let active = LendingOffer::new_active(params, total);
        let mut outputs = full_repayment_outputs(&params);
        outputs.extend(junk_outputs(&params, None));
        let tx = tx_with_outputs(outputs);

        let spend = active.classify_spend(&tx, 1, None).unwrap();

        let LendingOfferSpend::FullRepayment(scan) = spend else {
            panic!("expected full repayment, got {spend:?}");
        };
        assert_eq!(scan.amount_to_repay, total);
        assert_eq!(scan.debt_after, 0);
        assert_eq!(scan.lender_vault_vout, 1);
        assert_eq!(scan.protocol_fee_vault_vout, Some(2));
    }

    #[test]
    fn classifies_partial_repayment_with_junk_outputs() {
        let params = test_params();
        let active = LendingOffer::new_active(params, total_debt(&params));
        let (mut outputs, debt_after) = first_partial_repayment_outputs(&params);
        outputs.extend(junk_outputs(&params, Some(debt_after)));
        let tx = tx_with_outputs(outputs);

        let spend = active.classify_spend(&tx, 1, None).unwrap();

        let LendingOfferSpend::PartialRepayment(scan) = spend else {
            panic!("expected partial repayment, got {spend:?}");
        };
        assert_eq!(scan.amount_to_repay, 500);
        assert_eq!(scan.debt_after, debt_after);
        assert_eq!(scan.continuing_offer_vout, Some(1));
        assert_eq!(scan.lender_vault_vout, 2);
        assert_eq!(scan.protocol_fee_vault_vout, Some(3));
    }

    #[test]
    fn classifies_partial_repayment_that_burns_borrower_nft() {
        let params = test_params();
        let active = LendingOffer::new_active(params, total_debt(&params));
        let (mut outputs, _) = first_partial_repayment_outputs(&params);
        outputs[0] = op_return(params.borrower_nft_asset_id, 1);
        let tx = tx_with_outputs(outputs);

        let spend = active.classify_spend(&tx, 1, None).unwrap();

        assert!(matches!(spend, LendingOfferSpend::PartialRepayment(_)));
    }

    #[test]
    fn classifies_partial_fee_supply_from_vault_amounts_before() {
        let params = test_params();
        let total = total_debt(&params);
        let debt_before = total - 500;
        let active = LendingOffer::new_active(params, debt_before);
        let amount_to_repay = 200_u64;
        let debt_after = debt_before - amount_to_repay;
        let continuing = LendingOffer::new_active(params, debt_after);

        let protocol_fee = params
            .offer_parameters
            .get_repaid_protocol_fee(debt_before, amount_to_repay);
        let lender_delta = amount_to_repay - protocol_fee;
        let lender_before = params
            .get_lender_vault(debt_before)
            .get_already_supplied_amount();
        let protocol_before = params
            .get_protocol_fee_vault(debt_before)
            .get_already_supplied_amount();

        let tx = tx_with_outputs(vec![
            explicit_output(params.borrower_nft_asset_id, 1, script(&[0x51])),
            explicit_output(
                params.collateral_asset_id,
                3_000
                    - params
                        .offer_parameters
                        .get_collateral_for_principal(500 + 200),
                continuing.get_script_pubkey(),
            ),
            explicit_output(
                params.principal_asset_id,
                lender_before + lender_delta,
                params.get_lender_vault(debt_after).get_script_pubkey(),
            ),
            explicit_output(
                params.principal_asset_id,
                protocol_before + protocol_fee,
                params
                    .get_protocol_fee_vault(debt_after)
                    .get_script_pubkey(),
            ),
        ]);

        let spend = active
            .classify_spend(&tx, 1, Some((lender_before, Some(protocol_before))))
            .unwrap();

        let LendingOfferSpend::PartialRepayment(scan) = spend else {
            panic!("expected partial repayment, got {spend:?}");
        };
        assert_eq!(scan.amount_to_repay, amount_to_repay);
        assert_eq!(scan.debt_after, debt_after);
        assert_eq!(scan.protocol_fee_vault_vout, Some(3));
    }

    #[test]
    fn classifies_partial_principal_supply_without_protocol_fee_vault() {
        let params = test_params();
        let total = total_debt(&params);
        let total_fee = params.offer_parameters.get_total_fee();
        let debt_before = total - total_fee;
        let active = LendingOffer::new_active(params, debt_before);
        let amount_to_repay = 1_000_u64;
        let debt_after = debt_before - amount_to_repay;
        let continuing = LendingOffer::new_active(params, debt_after);
        let lender_before = params
            .get_lender_vault(debt_before)
            .get_already_supplied_amount();

        let tx = tx_with_outputs(vec![
            explicit_output(params.borrower_nft_asset_id, 1, script(&[0x51])),
            explicit_output(
                params.collateral_asset_id,
                3_000
                    - params
                        .offer_parameters
                        .get_collateral_for_principal(total_fee + amount_to_repay),
                continuing.get_script_pubkey(),
            ),
            explicit_output(
                params.principal_asset_id,
                lender_before + amount_to_repay,
                params.get_lender_vault(debt_after).get_script_pubkey(),
            ),
            explicit_output(params.collateral_asset_id, 1, script(&[0x53])),
        ]);

        let spend = active
            .classify_spend(&tx, 1, Some((lender_before, None)))
            .unwrap();

        let LendingOfferSpend::PartialRepayment(scan) = spend else {
            panic!("expected partial repayment, got {spend:?}");
        };
        assert_eq!(scan.amount_to_repay, amount_to_repay);
        assert_eq!(scan.debt_after, debt_after);
        assert!(scan.protocol_fee_vault_vout.is_none());
    }

    #[test]
    fn classifies_liquidation_with_junk_outputs() {
        let params = test_params();
        let active = LendingOffer::new_active(params, total_debt(&params));
        let mut outputs = liquidation_outputs(&params);
        outputs.extend(junk_outputs(&params, None));
        let tx = tx_with_outputs(outputs);

        let spend = active.classify_spend(&tx, 0, None).unwrap();

        let LendingOfferSpend::Liquidation(scan) = spend else {
            panic!("expected liquidation, got {spend:?}");
        };
        assert_eq!(scan.lender_nft_burn_vout, 0);
    }

    #[test]
    fn rejects_liquidation_layout_spent_from_repayment_input() {
        let params = test_params();
        let active = LendingOffer::new_active(params, total_debt(&params));
        let tx = tx_with_outputs(liquidation_outputs(&params));

        assert!(active.classify_spend(&tx, 1, None).is_err());
    }

    #[test]
    fn rejects_repayment_layout_spent_from_liquidation_input() {
        let params = test_params();
        let active = LendingOffer::new_active(params, total_debt(&params));
        let tx = tx_with_outputs(full_repayment_outputs(&params));

        assert!(active.classify_spend(&tx, 0, None).is_err());
    }

    #[test]
    fn rejects_active_offer_spent_from_other_input() {
        let params = test_params();
        let active = LendingOffer::new_active(params, total_debt(&params));
        let tx = tx_with_outputs(full_repayment_outputs(&params));

        assert!(active.classify_spend(&tx, 2, None).is_err());
    }
}
