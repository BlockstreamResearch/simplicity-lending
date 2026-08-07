use simplex::simplicityhl::elements::{AssetId, Transaction, TxOut};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActiveOfferSpendKind {
    FullRepayment,
    PartialRepayment { continuing_vout: u32 },
    Liquidation,
}

pub fn classify_active_offer_spend(
    tx: &Transaction,
    collateral_asset_id: &AssetId,
    collateral_remaining: u64,
) -> ActiveOfferSpendKind {
    if is_full_repayment_tx(tx) {
        return ActiveOfferSpendKind::FullRepayment;
    }

    if let Some(continuing_vout) =
        find_continuing_offer_vout(tx, collateral_asset_id, collateral_remaining)
    {
        return ActiveOfferSpendKind::PartialRepayment { continuing_vout };
    }

    ActiveOfferSpendKind::Liquidation
}

/// Full repayment burns the borrower NFT to OP_RETURN at output 0.
pub fn is_full_repayment_tx(tx: &Transaction) -> bool {
    if tx.output.len() < 5 {
        return false;
    }

    tx.output[0].is_null_data()
        && !tx.output[1].is_null_data()
        && !tx.output[2].is_null_data()
        && !tx.output[3].is_null_data()
}

fn find_continuing_offer_vout(
    tx: &Transaction,
    collateral_asset_id: &AssetId,
    collateral_remaining: u64,
) -> Option<u32> {
    if tx.output.is_empty() || tx.output[0].is_null_data() {
        return None;
    }

    if collateral_remaining == 0 {
        return None;
    }

    tx.output.iter().enumerate().find_map(|(vout, output)| {
        let amount = continuing_offer_collateral_amount(output, collateral_asset_id)?;
        if amount > 0 && amount < collateral_remaining {
            Some(vout as u32)
        } else {
            None
        }
    })
}

fn continuing_offer_collateral_amount(
    output: &TxOut,
    collateral_asset_id: &AssetId,
) -> Option<u64> {
    if output.script_pubkey.is_op_return() {
        return None;
    }

    let asset = output.asset.explicit()?;
    let amount = output.value.explicit()?;

    if asset == *collateral_asset_id {
        Some(amount)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::{ActiveOfferSpendKind, classify_active_offer_spend, is_full_repayment_tx};
    use simplex::simplicityhl::elements::{
        AssetId, LockTime, Script, Transaction, TxIn, TxOut, confidential,
    };

    fn asset(byte: u8) -> AssetId {
        AssetId::from_slice(&[byte; 32]).expect("asset")
    }

    fn script(byte: u8) -> Script {
        Script::from(vec![byte])
    }

    fn op_return_output() -> TxOut {
        TxOut {
            script_pubkey: Script::new_op_return(b"burn"),
            ..Default::default()
        }
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

    #[test]
    fn full_repayment_layout_matches_existing_heuristic() {
        let tx = tx_with_outputs(vec![
            op_return_output(),
            explicit_output(asset(1), 1, script(0x51)),
            explicit_output(asset(2), 100, script(0x52)),
            explicit_output(asset(2), 50, script(0x53)),
            explicit_output(asset(3), 10, script(0x54)),
        ]);

        assert!(is_full_repayment_tx(&tx));
        assert_eq!(
            classify_active_offer_spend(&tx, &asset(9), 1_000),
            ActiveOfferSpendKind::FullRepayment
        );
    }

    #[test]
    fn partial_repayment_finds_earliest_reduced_collateral_output() {
        let collateral = asset(0xaa);
        let tx = tx_with_outputs(vec![
            // Borrower NFT continues (not OP_RETURN).
            explicit_output(asset(0xbb), 1, script(0x51)),
            // Continuing offer covenant with reduced collateral.
            explicit_output(collateral, 700, script(0x52)),
            // Vault (principal asset) — ignored.
            explicit_output(asset(0xcc), 200, script(0x53)),
            // Unlocked collateral to borrower (also reduced; later vout).
            explicit_output(collateral, 300, script(0x54)),
        ]);

        assert_eq!(
            classify_active_offer_spend(&tx, &collateral, 1_000),
            ActiveOfferSpendKind::PartialRepayment { continuing_vout: 1 }
        );
    }

    #[test]
    fn partial_ignores_confidential_unlock_and_picks_explicit_covenant() {
        let collateral = asset(0xaa);
        let mut unlock = TxOut {
            script_pubkey: script(0x54),
            ..Default::default()
        };
        unlock.asset = confidential::Asset::Explicit(collateral);
        // Confidential value — must not be selected as continuing offer.

        let tx = tx_with_outputs(vec![
            explicit_output(asset(0xbb), 1, script(0x51)),
            explicit_output(collateral, 800, script(0x52)),
            unlock,
        ]);

        assert_eq!(
            classify_active_offer_spend(&tx, &collateral, 1_000),
            ActiveOfferSpendKind::PartialRepayment { continuing_vout: 1 }
        );
    }

    #[test]
    fn liquidation_when_no_reduced_collateral_covenant() {
        let collateral = asset(0xaa);
        let tx = tx_with_outputs(vec![
            // Not OP_RETURN, but collateral moved in full (typical liquidation take).
            explicit_output(collateral, 1_000, script(0x51)),
            explicit_output(asset(0x01), 1, script(0x52)),
        ]);

        assert_eq!(
            classify_active_offer_spend(&tx, &collateral, 1_000),
            ActiveOfferSpendKind::Liquidation
        );
    }

    #[test]
    fn liquidation_when_first_output_is_op_return_but_layout_too_short() {
        let collateral = asset(0xaa);
        let tx = tx_with_outputs(vec![
            op_return_output(),
            explicit_output(collateral, 500, script(0x51)),
        ]);

        assert!(!is_full_repayment_tx(&tx));
        assert_eq!(
            classify_active_offer_spend(&tx, &collateral, 1_000),
            ActiveOfferSpendKind::Liquidation
        );
    }
}
