use lending_contracts::programs::lending::{LendingOffer, LendingOfferRepaymentScan};
use simplex::simplicityhl::elements::Transaction;

/// How an `active_offer` UTXO spend should be interpreted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActiveOfferSpendKind {
    FullRepayment { scan: LendingOfferRepaymentScan },
    PartialRepayment { scan: LendingOfferRepaymentScan },
    Liquidation,
}

/// Amounts for DB updates / history after a partial repayment.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PartialRepaymentAmounts {
    pub debt_before: u64,
    pub debt_after: u64,
    pub collateral_before: u64,
    pub collateral_after: u64,
    pub amount_repaid: u64,
    pub collateral_unlocked: u64,
}

/// Classify a spend of an active lending offer UTXO using contract scanners.
///
/// `vault_amounts_before` is `(lender_vault_amount, protocol_vault_amount)` from prevouts.
/// Pass `None` for the first (`NoRepayments`) partial; fee/principal supply phases need
/// `Some(...)` once vault UTXO amounts are tracked in the indexer.
pub fn classify_active_offer_spend(
    offer: &LendingOffer,
    tx: &Transaction,
    vault_amounts_before: Option<(u64, Option<u64>)>,
) -> anyhow::Result<ActiveOfferSpendKind> {
    if let Some(scan) = offer.scan_full_repayment(tx, 0, 0) {
        return Ok(ActiveOfferSpendKind::FullRepayment { scan });
    }

    if let Some(scan) = offer.discover_partial_repayment(tx, 0, 0, vault_amounts_before) {
        return Ok(ActiveOfferSpendKind::PartialRepayment { scan });
    }

    if offer.scan_liquidation(tx).is_some() {
        return Ok(ActiveOfferSpendKind::Liquidation);
    }

    anyhow::bail!("unclassified active offer spend")
}

/// Map a partial repayment scan (+ DB collateral before) into history amounts.
pub fn partial_repayment_amounts_from_scan(
    scan: &LendingOfferRepaymentScan,
    collateral_before: u64,
) -> anyhow::Result<PartialRepaymentAmounts> {
    let collateral_after = scan
        .collateral_after
        .ok_or_else(|| anyhow::anyhow!("partial repayment scan missing collateral_after"))?;

    if collateral_after >= collateral_before {
        anyhow::bail!(
            "partial repayment collateral_after ({collateral_after}) must be < collateral_before ({collateral_before})"
        );
    }

    Ok(PartialRepaymentAmounts {
        debt_before: scan.debt_before,
        debt_after: scan.debt_after,
        collateral_before,
        collateral_after,
        amount_repaid: scan.amount_to_repay,
        collateral_unlocked: collateral_before - collateral_after,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        ActiveOfferSpendKind, classify_active_offer_spend, partial_repayment_amounts_from_scan,
    };
    use lending_contracts::programs::{
        asset_auth_vault::AssetAuthVault,
        lending::{
            LendingOffer, LendingOfferParameters, LendingOfferRepaymentScan, OfferParameters,
        },
        program::SimplexProgram,
    };
    use simplex::{
        provider::SimplicityNetwork,
        simplicityhl::elements::{
            AssetId, LockTime, Script, Transaction, TxIn, TxOut, confidential,
        },
    };

    fn asset(byte: u8) -> AssetId {
        AssetId::from_slice(&[byte; 32]).expect("asset")
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

    fn op_return_asset(asset_id: AssetId) -> TxOut {
        let mut output = TxOut {
            script_pubkey: Script::new_op_return(b"burn"),
            ..Default::default()
        };
        output.asset = confidential::Asset::Explicit(asset_id);
        output.value = confidential::Value::Explicit(1);
        output
    }

    fn tx_with_outputs(outputs: Vec<TxOut>) -> Transaction {
        Transaction {
            version: 2,
            lock_time: LockTime::ZERO,
            input: vec![TxIn {
                previous_output: Default::default(),
                ..Default::default()
            }],
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

    #[test]
    fn classify_partial_uses_vault_derived_amount() {
        let params = test_params();
        let total = params.offer_parameters.get_total_amount_to_repay();
        let active = LendingOffer::new_active(params, total);
        let amount_to_repay = 500_u64;
        let debt_after = total - amount_to_repay;
        let continuing = LendingOffer::new_active(params, debt_after);

        let protocol_fee = params
            .offer_parameters
            .get_repaid_protocol_fee(total, amount_to_repay);
        let lender_amount = amount_to_repay - protocol_fee;
        let lender_vault =
            AssetAuthVault::new_active(params.get_lender_vault_parameters(), lender_amount);
        let protocol_vault =
            AssetAuthVault::new_active(params.get_protocol_fee_vault_parameters(), protocol_fee);

        let tx = tx_with_outputs(vec![
            explicit_output(params.borrower_nft_asset_id, 1, script(&[0x51])),
            explicit_output(
                params.collateral_asset_id,
                3_000 - 136,
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
        ]);

        let kind = classify_active_offer_spend(&active, &tx, None).unwrap();
        let ActiveOfferSpendKind::PartialRepayment { scan } = kind else {
            panic!("expected partial repayment, got {kind:?}");
        };

        assert_eq!(scan.amount_to_repay, amount_to_repay);
        assert_eq!(scan.continuing_offer_vout, Some(1));

        let amounts = partial_repayment_amounts_from_scan(&scan, 3_000).unwrap();
        assert_eq!(amounts.amount_repaid, 500);
        assert_eq!(amounts.debt_after, debt_after);
        assert_eq!(amounts.collateral_unlocked, 136);
        // Vault truth, not collateral reverse-math (which truncates to 1998 for 545 unlocked).
        assert_ne!(amounts.amount_repaid, 136 * total / 3_000);
    }

    #[test]
    fn classify_full_repayment() {
        let params = test_params();
        let total = params.offer_parameters.get_total_amount_to_repay();
        let active = LendingOffer::new_active(params, total);

        let protocol_fee = params.offer_parameters.get_total_protocol_fee();
        let lender_amount = total - protocol_fee;
        let lender_vault = AssetAuthVault::new_finalized(params.get_lender_vault_parameters());
        let protocol_vault =
            AssetAuthVault::new_finalized(params.get_protocol_fee_vault_parameters());

        let tx = tx_with_outputs(vec![
            op_return_asset(params.borrower_nft_asset_id),
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
            explicit_output(params.collateral_asset_id, 10, script(&[0x99])),
        ]);

        let kind = classify_active_offer_spend(&active, &tx, None).unwrap();
        let ActiveOfferSpendKind::FullRepayment { scan } = kind else {
            panic!("expected full repayment, got {kind:?}");
        };
        assert_eq!(scan.amount_to_repay, total);
        assert_eq!(scan.debt_after, 0);
    }

    #[test]
    fn classify_liquidation() {
        let params = test_params();
        let total = params.offer_parameters.get_total_amount_to_repay();
        let active = LendingOffer::new_active(params, total);

        let tx = tx_with_outputs(vec![
            op_return_asset(params.lender_nft_asset_id),
            explicit_output(params.collateral_asset_id, 3_000, script(&[0x51])),
        ]);

        assert_eq!(
            classify_active_offer_spend(&active, &tx, None).unwrap(),
            ActiveOfferSpendKind::Liquidation
        );
    }

    #[test]
    fn unclassified_spend_is_error_not_liquidation() {
        let params = test_params();
        let total = params.offer_parameters.get_total_amount_to_repay();
        let active = LendingOffer::new_active(params, total);
        let tx = tx_with_outputs(vec![explicit_output(
            params.collateral_asset_id,
            3_000,
            script(&[0x51]),
        )]);

        let err = classify_active_offer_spend(&active, &tx, None).unwrap_err();
        assert!(err.to_string().contains("unclassified"));
    }

    #[test]
    fn partial_amounts_reject_non_decreasing_collateral() {
        let scan = LendingOfferRepaymentScan {
            amount_to_repay: 100,
            debt_before: 1_000,
            debt_after: 900,
            collateral_after: Some(500),
            continuing_offer_vout: Some(1),
            lender_vault_vout: 2,
            protocol_fee_vault_vout: Some(3),
        };

        assert!(partial_repayment_amounts_from_scan(&scan, 500).is_err());
        assert!(partial_repayment_amounts_from_scan(&scan, 400).is_err());
    }
}
