use simplex::{
    provider::SimplicityNetwork,
    simplicityhl::elements::{AssetId, Script, Transaction, TxOut, Txid},
};

use crate::programs::asset_auth_vault::AssetAuthVault;
use crate::programs::lending::metadata::LendingOfferCreationMetadata;
use crate::programs::lending::{
    LendingOffer, LendingOfferError, LendingOfferParameters, OfferParameters,
};
use crate::programs::program::{MetadataProgram, SimplexProgram};
use crate::programs::script_auth::ScriptAuth;
use crate::utils::{
    TxOutFilter, find_unique_op_return_asset_vout, find_unique_vout, op_return_payload,
};

/// Offer UTXO roles relative to a known [`LendingOffer`] instance.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LendingOfferUtxoKind {
    PendingOffer,
    ActiveOffer { current_debt: u64 },
}

/// High-level lending-offer transaction kinds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LendingOfferTxKind {
    Creation,
    Acceptance,
    Cancellation,
    PartialRepayment,
    FullRepayment,
    Liquidation,
}

/// Fixed I/O indexes for a repayment bundle relative to borrower NFT indexes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LendingRepaymentIoLayout {
    pub offer_input: u32,
    pub offer_output: Option<u32>,
    pub lender_vault_input: Option<u32>,
    pub lender_vault_output: u32,
    pub protocol_fee_vault_input: Option<u32>,
    pub protocol_fee_vault_output: Option<u32>,
}

/// Layout of a successful offer creation transaction.
#[derive(Debug, Clone)]
pub struct LendingOfferCreationScan {
    pub pending_offer_vout: u32,
    pub borrower_nft_vout: u32,
    pub borrower_nft_script_pubkey: Script,
    pub lender_nft_vout: u32,
    pub lender_nft_script_pubkey: Script,
}

/// Parsed offer creation: pending offer + participant NFT layout.
pub struct LendingOfferCreation {
    pub offer: LendingOffer,
    pub pending_offer_vout: u32,
    pub borrower_nft_vout: u32,
    pub borrower_nft_script_pubkey: Script,
    pub lender_nft_vout: u32,
    pub lender_nft_script_pubkey: Script,
}

/// Acceptance layout (pending -> active).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LendingOfferAcceptanceScan {
    pub active_offer_vout: u32,
    pub collateral_amount: u64,
    pub borrower_principal_vout: u32,
}

/// Cancellation layout (pending burned).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LendingOfferCancellationScan {
    pub lender_nft_burn_vout: u32,
    pub borrower_nft_burn_vout: u32,
}

/// Partial or full repayment layout + exact amounts from vault principal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LendingOfferRepaymentScan {
    pub amount_to_repay: u64,
    pub debt_before: u64,
    pub debt_after: u64,
    pub collateral_after: Option<u64>,
    pub continuing_offer_vout: Option<u32>,
    pub lender_vault_vout: u32,
    pub protocol_fee_vault_vout: Option<u32>,
}

/// Liquidation layout.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LendingOfferLiquidationScan {
    pub lender_nft_burn_vout: u32,
}

impl LendingOffer {
    /// Parse an offer creation transaction into offer parameters + output layout.
    pub fn try_from_tx(
        tx: &Transaction,
        protocol_fee_keeper_asset_id: AssetId,
        network: SimplicityNetwork,
    ) -> Result<LendingOfferCreation, LendingOfferError> {
        let txid = tx.txid();
        let offer = Self::offer_from_creation_tx(tx, protocol_fee_keeper_asset_id, network, txid)?;
        let scan = offer
            .scan_creation(tx)
            .ok_or(LendingOfferError::NotALendingOfferCreationTx(txid))?;

        Ok(LendingOfferCreation {
            offer,
            pending_offer_vout: scan.pending_offer_vout,
            borrower_nft_vout: scan.borrower_nft_vout,
            borrower_nft_script_pubkey: scan.borrower_nft_script_pubkey,
            lender_nft_vout: scan.lender_nft_vout,
            lender_nft_script_pubkey: scan.lender_nft_script_pubkey,
        })
    }

    /// Scan creation layout: unique pending offer + borrower NFT + ScriptAuth-locked lender NFT.
    pub fn scan_creation(&self, tx: &Transaction) -> Option<LendingOfferCreationScan> {
        if !self.is_pending_offer() {
            return None;
        }

        let params = self.get_parameters();
        let (pending_offer_vout, _) = self.find_unique_vout_matching(tx)?;

        let (borrower_nft_vout, borrower_nft_script_pubkey) =
            self.find_unique_participant_nft(tx, params.borrower_nft_asset_id)?;

        let lender_nft_auth = ScriptAuth::from_simplex_program(self);
        let lender_scan = lender_nft_auth.scan_creation(tx, params.lender_nft_asset_id, Some(1))?;
        let lender_nft_script_pubkey = tx
            .output
            .get(lender_scan.program_vout as usize)?
            .script_pubkey
            .clone();

        Some(LendingOfferCreationScan {
            pending_offer_vout,
            borrower_nft_vout,
            borrower_nft_script_pubkey,
            lender_nft_vout: lender_scan.program_vout,
            lender_nft_script_pubkey,
        })
    }

    fn offer_from_creation_tx(
        tx: &Transaction,
        protocol_fee_keeper_asset_id: AssetId,
        network: SimplicityNetwork,
        txid: Txid,
    ) -> Result<Self, LendingOfferError> {
        let op_return_bytes = Self::has_creation_metadata(tx)
            .ok_or(LendingOfferError::NotALendingOfferCreationTx(txid))?;

        let creation_metadata = Self::decode_metadata_op_return(op_return_bytes.to_vec())?;

        if creation_metadata.program_id != Self::get_program_id() {
            return Err(LendingOfferError::NotALendingOfferCreationTx(txid));
        }

        let parameters = Self::parameters_from_creation_outputs(
            tx,
            &creation_metadata,
            protocol_fee_keeper_asset_id,
            network,
        )
        .ok_or(LendingOfferError::NotALendingOfferCreationTx(txid))?;

        Ok(Self::new_pending(parameters))
    }

    fn has_creation_metadata(tx: &Transaction) -> Option<&[u8]> {
        if tx.output.len() <= Self::CREATION_PENDING_OFFER_OUTPUT_INDEX {
            return None;
        }

        let output = &tx.output[Self::CREATION_METADATA_OUTPUT_INDEX];
        if !output.is_null_data() {
            return None;
        }

        op_return_payload(&output.script_pubkey)
    }

    fn parameters_from_creation_outputs(
        tx: &Transaction,
        creation_metadata: &LendingOfferCreationMetadata,
        protocol_fee_keeper_asset_id: AssetId,
        network: SimplicityNetwork,
    ) -> Option<LendingOfferParameters> {
        let borrower_nft_tx_out = tx.output.get(Self::CREATION_BORROWER_NFT_OUTPUT_INDEX)?;
        let lender_nft_tx_out = tx.output.get(Self::CREATION_LENDER_NFT_OUTPUT_INDEX)?;
        let pending_offer_tx_out = tx.output.get(Self::CREATION_PENDING_OFFER_OUTPUT_INDEX)?;

        let collateral_amount = pending_offer_tx_out.value.explicit()?;
        let collateral_asset_id = pending_offer_tx_out.asset.explicit()?;
        let borrower_nft_asset_id = borrower_nft_tx_out.asset.explicit()?;
        let lender_nft_asset_id = lender_nft_tx_out.asset.explicit()?;

        let offer_parameters = OfferParameters {
            collateral_amount,
            principal_amount: creation_metadata.principal_amount,
            loan_expiration_time: creation_metadata.loan_expiration_time,
            principal_interest_rate: creation_metadata.principal_interest_rate,
            protocol_fee_rate: creation_metadata.protocol_fee_rate,
        };

        // Such an offer can never be accepted, so it is not a lending offer worth tracking.
        if !offer_parameters.has_valid_protocol_fee_rate() {
            return None;
        }

        Some(LendingOfferParameters {
            collateral_asset_id,
            principal_asset_id: creation_metadata.principal_asset_id,
            protocol_fee_keeper_asset_id,
            borrower_nft_asset_id,
            lender_nft_asset_id,
            offer_parameters,
            network,
        })
    }

    fn find_unique_participant_nft(
        &self,
        tx: &Transaction,
        nft_asset_id: AssetId,
    ) -> Option<(u32, Script)> {
        let (vout, _) = find_unique_vout(
            tx,
            TxOutFilter::new()
                .asset(nft_asset_id)
                .amount(1)
                .require_op_return(false),
        )?;
        let script_pubkey = tx.output.get(vout as usize)?.script_pubkey.clone();
        Some((vout, script_pubkey))
    }

    /// Partial repayment I/O indexes relative to borrower NFT I/O (simf defaults: 0,0).
    pub fn partial_repayment_layout(
        borrower_nft_input: u32,
        borrower_nft_output: u32,
    ) -> LendingRepaymentIoLayout {
        LendingRepaymentIoLayout {
            offer_input: borrower_nft_input + 1,
            offer_output: Some(borrower_nft_output + 1),
            lender_vault_input: Some(borrower_nft_input + 2),
            lender_vault_output: borrower_nft_output + 2,
            protocol_fee_vault_input: Some(borrower_nft_input + 3),
            protocol_fee_vault_output: Some(borrower_nft_output + 3),
        }
    }

    /// Full repayment I/O indexes relative to borrower NFT I/O (simf defaults: 0,0).
    pub fn full_repayment_layout(
        borrower_nft_input: u32,
        borrower_nft_output: u32,
    ) -> LendingRepaymentIoLayout {
        LendingRepaymentIoLayout {
            offer_input: borrower_nft_input + 1,
            offer_output: None,
            lender_vault_input: Some(borrower_nft_input + 2),
            lender_vault_output: borrower_nft_output + 1,
            protocol_fee_vault_input: Some(borrower_nft_input + 3),
            protocol_fee_vault_output: Some(borrower_nft_output + 2),
        }
    }

    /// Whether `output` is this offer instance (collateral asset + script).
    pub fn matches_output(&self, output: &TxOut) -> bool {
        let (Some(asset), Some(_amount)) = (output.asset.explicit(), output.value.explicit())
        else {
            return false;
        };

        asset == self.get_parameters().collateral_asset_id
            && output.script_pubkey == self.get_script_pubkey()
            && !output.script_pubkey.is_op_return()
    }

    /// Classify an output as this pending/active offer instance.
    pub fn classify_output(&self, output: &TxOut) -> Option<LendingOfferUtxoKind> {
        if !self.matches_output(output) {
            return None;
        }

        Some(if self.is_pending_offer() {
            LendingOfferUtxoKind::PendingOffer
        } else {
            LendingOfferUtxoKind::ActiveOffer {
                current_debt: self.get_current_debt(),
            }
        })
    }

    /// Classify a spend/related tx for this offer instance (`self` = pre-state).
    ///
    /// Partial repayment is detected via `discover_partial_repayment(..., None)`, so only the
    /// first partial (vault creates) is classified here. Later partials need prevout vault
    /// amounts — call `discover_partial_repayment` with `vault_amounts_before` instead. Borrower NFT I/O indexes are fixed at `(0, 0)` (simf default).
    pub fn classify_tx(&self, tx: &Transaction) -> Option<LendingOfferTxKind> {
        if self.is_pending_offer() {
            if self.scan_creation(tx).is_some() && Self::has_creation_metadata(tx).is_some() {
                return Some(LendingOfferTxKind::Creation);
            }
            if self.scan_cancellation(tx).is_some() {
                return Some(LendingOfferTxKind::Cancellation);
            }
            if self.scan_acceptance(tx).is_some() {
                return Some(LendingOfferTxKind::Acceptance);
            }
            return None;
        }

        // Active offer spends.
        if self.scan_full_repayment(tx, 0, 0).is_some() {
            return Some(LendingOfferTxKind::FullRepayment);
        }
        // `None` prevouts: only the first partial, which creates the vaults.
        if self.discover_partial_repayment(tx, 0, 0, None).is_some() {
            return Some(LendingOfferTxKind::PartialRepayment);
        }
        if self.scan_liquidation(tx).is_some() {
            return Some(LendingOfferTxKind::Liquidation);
        }

        None
    }

    /// Pending -> active: ScriptAuth lender-NFT unlock + active offer + borrower principal.
    pub fn scan_acceptance(&self, tx: &Transaction) -> Option<LendingOfferAcceptanceScan> {
        if !self.is_pending_offer() {
            return None;
        }

        let params = self.get_parameters();
        let lender_nft_auth = ScriptAuth::from_simplex_program(self);
        lender_nft_auth.scan_unlock_with_authorizing_script(tx, &self.get_script_pubkey())?;

        let total_debt = params.offer_parameters.get_total_amount_to_repay();
        let active = LendingOffer::new_active(*params, total_debt);

        let (active_offer_vout, collateral_amount) = active.find_unique_vout_matching(tx)?;

        let (borrower_principal_vout, _) = params
            .get_principal_output_asset_auth()
            .find_unique_locked_vout(
                tx,
                params.principal_asset_id,
                Some(params.offer_parameters.principal_amount),
            )?;

        Some(LendingOfferAcceptanceScan {
            active_offer_vout,
            collateral_amount,
            borrower_principal_vout,
        })
    }

    /// Pending cancellation: ScriptAuth lender-NFT unlock + lender/borrower NFT burns.
    pub fn scan_cancellation(&self, tx: &Transaction) -> Option<LendingOfferCancellationScan> {
        if !self.is_pending_offer() {
            return None;
        }

        if self.find_unique_vout_matching(tx).is_some() {
            return None;
        }

        let lender_nft_auth = ScriptAuth::from_simplex_program(self);
        lender_nft_auth.scan_unlock_with_authorizing_script(tx, &self.get_script_pubkey())?;

        let params = self.get_parameters();
        let lender_nft_burn_vout =
            find_unique_op_return_asset_vout(tx, params.lender_nft_asset_id)?;
        let borrower_nft_burn_vout =
            find_unique_op_return_asset_vout(tx, params.borrower_nft_asset_id)?;

        Some(LendingOfferCancellationScan {
            lender_nft_burn_vout,
            borrower_nft_burn_vout,
        })
    }

    /// Verify a partial repayment for a known `amount_to_repay`.
    pub fn scan_partial_repayment(
        &self,
        tx: &Transaction,
        amount_to_repay: u64,
        borrower_nft_input: u32,
        borrower_nft_output: u32,
    ) -> Option<LendingOfferRepaymentScan> {
        if !self.is_active_offer() || amount_to_repay == 0 {
            return None;
        }

        let debt_before = self.get_current_debt();
        if amount_to_repay >= debt_before {
            return None;
        }

        let debt_after = debt_before - amount_to_repay;
        let continuing = LendingOffer::new_active(*self.get_parameters(), debt_after);
        let (continuing_offer_vout, collateral_after) = continuing.find_unique_vout_matching(tx)?;

        let layout = Self::partial_repayment_layout(borrower_nft_input, borrower_nft_output);
        let vaults = self.scan_repayment_vaults(tx, debt_before, amount_to_repay, &layout)?;

        Some(LendingOfferRepaymentScan {
            amount_to_repay,
            debt_before,
            debt_after,
            collateral_after: Some(collateral_after),
            continuing_offer_vout: Some(continuing_offer_vout),
            lender_vault_vout: vaults.0,
            protocol_fee_vault_vout: vaults.1,
        })
    }

    /// Discover a partial repayment from vault principal deltas, then verify layout.
    ///
    /// `vault_amounts_before` is `(lender_vault_amount, protocol_vault_amount)` from prevouts.
    /// It is required once the lender vault exists (any repayment before this one); the protocol
    /// amount is required once the protocol fee vault exists. Vaults that do not exist yet are
    /// created by this repayment, so their output amounts are the deltas from zero.
    pub fn discover_partial_repayment(
        &self,
        tx: &Transaction,
        borrower_nft_input: u32,
        borrower_nft_output: u32,
        vault_amounts_before: Option<(u64, Option<u64>)>,
    ) -> Option<LendingOfferRepaymentScan> {
        if !self.is_active_offer() {
            return None;
        }

        let layout = Self::partial_repayment_layout(borrower_nft_input, borrower_nft_output);

        self.repayment_amount_candidates(tx, &layout, vault_amounts_before)
            .into_iter()
            .find_map(|amount_to_repay| {
                self.scan_partial_repayment(
                    tx,
                    amount_to_repay,
                    borrower_nft_input,
                    borrower_nft_output,
                )
            })
    }

    /// Full repayment: borrower NFT burned, vaults absorb full debt.
    pub fn scan_full_repayment(
        &self,
        tx: &Transaction,
        borrower_nft_input: u32,
        borrower_nft_output: u32,
    ) -> Option<LendingOfferRepaymentScan> {
        if !self.is_active_offer() {
            return None;
        }

        let debt_before = self.get_current_debt();
        if debt_before == 0 {
            return None;
        }

        let borrower_nft = self.get_parameters().borrower_nft_asset_id;
        let _burn_vout = find_unique_op_return_asset_vout(tx, borrower_nft)?;

        let layout = Self::full_repayment_layout(borrower_nft_input, borrower_nft_output);
        let vaults = self.scan_repayment_vaults(tx, debt_before, debt_before, &layout)?;

        Some(LendingOfferRepaymentScan {
            amount_to_repay: debt_before,
            debt_before,
            debt_after: 0,
            collateral_after: None,
            continuing_offer_vout: None,
            lender_vault_vout: vaults.0,
            protocol_fee_vault_vout: vaults.1,
        })
    }

    /// Liquidation: lender NFT burn, not a full-repayment or partial-repayment layout.
    pub fn scan_liquidation(&self, tx: &Transaction) -> Option<LendingOfferLiquidationScan> {
        if !self.is_active_offer() {
            return None;
        }

        if self.scan_full_repayment(tx, 0, 0).is_some() {
            return None;
        }
        if self.discover_partial_repayment(tx, 0, 0, None).is_some() {
            return None;
        }

        let lender_nft = self.get_parameters().lender_nft_asset_id;
        let lender_nft_burn_vout = find_unique_op_return_asset_vout(tx, lender_nft)?;

        Some(LendingOfferLiquidationScan {
            lender_nft_burn_vout,
        })
    }

    /// Unique output matching this exact offer instance.
    pub fn find_unique_vout_matching(&self, tx: &Transaction) -> Option<(u32, u64)> {
        let script = self.get_script_pubkey();
        find_unique_vout(
            tx,
            TxOutFilter::new()
                .asset(self.get_parameters().collateral_asset_id)
                .script_pubkey(&script)
                .require_op_return(false),
        )
    }

    /// Candidate `amount_to_repay` values recovered from vault principal output deltas at fixed
    /// layout indexes: one where the protocol fee vault output is part of the repayment, and one
    /// where it is not touched. Each candidate already follows the fee split; vault scripts are
    /// checked afterwards by [`Self::scan_partial_repayment`].
    fn repayment_amount_candidates(
        &self,
        tx: &Transaction,
        layout: &LendingRepaymentIoLayout,
        vault_amounts_before: Option<(u64, Option<u64>)>,
    ) -> Vec<u64> {
        let debt_before = self.get_current_debt();
        let offer_parameters = self.get_parameters().offer_parameters;

        let Some(lender_out_amount) = explicit_output_amount(tx, layout.lender_vault_output) else {
            return Vec::new();
        };

        let (lender_before, protocol_before) = if offer_parameters.has_lender_vault(debt_before) {
            let Some(amounts_before) = vault_amounts_before else {
                return Vec::new();
            };
            amounts_before
        } else {
            (0, None)
        };
        let protocol_before = if offer_parameters.has_protocol_fee_vault(debt_before) {
            protocol_before
        } else {
            Some(0)
        };

        let Some(lender_delta) = lender_out_amount.checked_sub(lender_before) else {
            return Vec::new();
        };

        let protocol_delta = layout
            .protocol_fee_vault_output
            .and_then(|vout| explicit_output_amount(tx, vout))
            .zip(protocol_before)
            .and_then(|(protocol_out_amount, protocol_before)| {
                protocol_out_amount.checked_sub(protocol_before)
            })
            .filter(|protocol_delta| *protocol_delta > 0);

        let with_protocol_fee = protocol_delta.map(|protocol_delta| (lender_delta, protocol_delta));
        let without_protocol_fee = Some((lender_delta, 0));

        [with_protocol_fee, without_protocol_fee]
            .into_iter()
            .flatten()
            .filter_map(|(lender_delta, protocol_delta)| {
                let amount_to_repay = lender_delta.checked_add(protocol_delta)?;

                if amount_to_repay == 0 || amount_to_repay >= debt_before {
                    return None;
                }

                let deltas =
                    repayment_vault_deltas(self.get_parameters(), debt_before, amount_to_repay)?;

                (deltas == (lender_delta, protocol_delta)).then_some(amount_to_repay)
            })
            .collect()
    }

    fn scan_repayment_vaults(
        &self,
        tx: &Transaction,
        debt_before: u64,
        amount_to_repay: u64,
        layout: &LendingRepaymentIoLayout,
    ) -> Option<(u32, Option<u32>)> {
        let params = self.get_parameters();
        let debt_after = debt_before.checked_sub(amount_to_repay)?;
        let (lender_delta, protocol_fee_repaid) =
            repayment_vault_deltas(params, debt_before, amount_to_repay)?;

        // The covenant rejects repayments that leave nothing for the lender.
        if lender_delta == 0 {
            return None;
        }

        let lender_after = params.get_lender_vault(debt_after);

        // The protocol fee vault only changes when this repayment carries a protocol share.
        let protocol_after =
            (protocol_fee_repaid > 0).then(|| params.get_protocol_fee_vault(debt_after));
        let protocol_vout = match protocol_after {
            Some(_) => Some(layout.protocol_fee_vault_output?),
            None => None,
        };

        match_vault_outs(
            tx,
            layout.lender_vault_output,
            protocol_vout,
            &lender_after,
            protocol_after.as_ref(),
        )
    }
}

fn repayment_vault_deltas(
    params: &LendingOfferParameters,
    debt_before: u64,
    amount_to_repay: u64,
) -> Option<(u64, u64)> {
    let debt_after = debt_before.checked_sub(amount_to_repay)?;
    let protocol_fee_before = params
        .offer_parameters
        .get_already_repaid_protocol_fee(debt_before);
    let protocol_fee_after = params
        .offer_parameters
        .get_already_repaid_protocol_fee(debt_after);
    let protocol_fee_repaid = protocol_fee_after.checked_sub(protocol_fee_before)?;
    let lender_delta = amount_to_repay.checked_sub(protocol_fee_repaid)?;

    Some((lender_delta, protocol_fee_repaid))
}

fn match_vault_outs(
    tx: &Transaction,
    lender_vout: u32,
    protocol_vout: Option<u32>,
    lender: &AssetAuthVault,
    protocol: Option<&AssetAuthVault>,
) -> Option<(u32, Option<u32>)> {
    let lender_out = tx.output.get(lender_vout as usize)?;

    if !lender.matches_output(lender_out) {
        return None;
    }

    match (protocol_vout, protocol) {
        (None, None) => Some((lender_vout, None)),
        (Some(protocol_vout), Some(protocol)) => {
            let protocol_out = tx.output.get(protocol_vout as usize)?;

            if !protocol.matches_output(protocol_out) {
                return None;
            }

            Some((lender_vout, Some(protocol_vout)))
        }
        _ => None,
    }
}

fn explicit_output_amount(tx: &Transaction, vout: u32) -> Option<u64> {
    tx.output.get(vout as usize)?.value.explicit()
}

#[cfg(test)]
mod tests {
    use super::{LendingOfferTxKind, LendingOfferUtxoKind};
    use crate::programs::asset_auth_vault::AssetAuthVault;
    use crate::programs::lending::{LendingOffer, LendingOfferParameters, OfferParameters};
    use crate::programs::program::SimplexProgram;
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
                protocol_fee_rate: 1_000,
            },
            network: SimplicityNetwork::default_regtest(),
        }
    }

    #[test]
    fn classify_output_pending_and_active() {
        let params = test_params();
        let pending = LendingOffer::new_pending(params);
        let total = params.offer_parameters.get_total_amount_to_repay();
        let active = LendingOffer::new_active(params, total);

        assert_eq!(
            pending.classify_output(&explicit_output(
                params.collateral_asset_id,
                3_000,
                pending.get_script_pubkey(),
            )),
            Some(LendingOfferUtxoKind::PendingOffer)
        );
        assert_eq!(
            active.classify_output(&explicit_output(
                params.collateral_asset_id,
                3_000,
                active.get_script_pubkey(),
            )),
            Some(LendingOfferUtxoKind::ActiveOffer {
                current_debt: total
            })
        );
    }

    #[test]
    fn scan_cancellation_finds_nft_burns() {
        let params = test_params();
        let pending = LendingOffer::new_pending(params);
        let tx = tx_with_outputs(vec![
            op_return_asset(params.lender_nft_asset_id),
            op_return_asset(params.borrower_nft_asset_id),
            explicit_output(params.collateral_asset_id, 3_000, script(&[0x51])),
        ]);

        let scan = pending.scan_cancellation(&tx).expect("cancel");
        assert_eq!(scan.lender_nft_burn_vout, 0);
        assert_eq!(scan.borrower_nft_burn_vout, 1);
        assert_eq!(
            pending.classify_tx(&tx),
            Some(LendingOfferTxKind::Cancellation)
        );
    }

    #[test]
    fn scan_acceptance_finds_active_offer_and_principal() {
        let params = test_params();
        let pending = LendingOffer::new_pending(params);
        let total = params.offer_parameters.get_total_amount_to_repay();
        let active = LendingOffer::new_active(params, total);
        let principal_auth = params.get_principal_output_asset_auth();

        let tx = tx_with_outputs(vec![
            explicit_output(
                params.collateral_asset_id,
                3_000,
                active.get_script_pubkey(),
            ),
            explicit_output(
                params.principal_asset_id,
                10_000,
                principal_auth.get_script_pubkey(),
            ),
            explicit_output(params.lender_nft_asset_id, 1, script(&[0x52])),
        ]);

        let scan = pending.scan_acceptance(&tx).expect("accept");
        assert_eq!(scan.active_offer_vout, 0);
        assert_eq!(scan.borrower_principal_vout, 1);
        assert_eq!(
            pending.classify_tx(&tx),
            Some(LendingOfferTxKind::Acceptance)
        );
    }

    #[test]
    fn discover_partial_repayment_no_repayments_phase() {
        let params = test_params();
        let total = params.offer_parameters.get_total_amount_to_repay(); // 11000
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

        // Layout: nft@0, offer@1, lender@2, protocol@3
        let tx = tx_with_outputs(vec![
            explicit_output(params.borrower_nft_asset_id, 1, script(&[0x51])),
            explicit_output(
                params.collateral_asset_id,
                // unlock = 500 * 3000 / 11000 = 136
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

        let scan = active
            .discover_partial_repayment(&tx, 0, 0, None)
            .expect("partial");
        assert_eq!(scan.amount_to_repay, amount_to_repay);
        assert_eq!(scan.debt_after, debt_after);
        assert_eq!(scan.continuing_offer_vout, Some(1));
        assert_eq!(scan.lender_vault_vout, 2);
        assert_eq!(scan.protocol_fee_vault_vout, Some(3));
        assert_eq!(
            active.classify_tx(&tx),
            Some(LendingOfferTxKind::PartialRepayment)
        );
    }

    #[test]
    fn discover_partial_repayment_fee_phase_uses_vault_deltas() {
        let params = test_params();
        let total = params.offer_parameters.get_total_amount_to_repay();
        // After a first repayment of 500, fee is still being repaid.
        let debt_before = total - 500;
        let active = LendingOffer::new_active(params, debt_before);
        let amount_to_repay = 200_u64;
        let debt_after = debt_before - amount_to_repay;
        let continuing = LendingOffer::new_active(params, debt_after);

        let protocol_fee = params
            .offer_parameters
            .get_repaid_protocol_fee(debt_before, amount_to_repay);
        let lender_delta = amount_to_repay - protocol_fee;

        let lender_before_vault = params.get_lender_vault(debt_before);
        let protocol_before_vault = params.get_protocol_fee_vault(debt_before);
        let lender_before = lender_before_vault.get_already_supplied_amount();
        let protocol_before = protocol_before_vault.get_already_supplied_amount();

        // Assume no withdraw: UTXO amount still equals already_supplied.
        let lender_after_supplied = lender_before + lender_delta;
        let protocol_after_supplied = protocol_before + protocol_fee;
        let lender_after =
            AssetAuthVault::new_active(params.get_lender_vault_parameters(), lender_after_supplied);
        let protocol_after = AssetAuthVault::new_active(
            params.get_protocol_fee_vault_parameters(),
            protocol_after_supplied,
        );

        let tx = tx_with_outputs(vec![
            explicit_output(params.borrower_nft_asset_id, 1, script(&[0x51])),
            explicit_output(
                params.collateral_asset_id,
                // first unlock 136, second unlock 200*3000/11000 = 54
                3_000 - 136 - 54,
                continuing.get_script_pubkey(),
            ),
            explicit_output(
                params.principal_asset_id,
                lender_before + lender_delta,
                lender_after.get_script_pubkey(),
            ),
            explicit_output(
                params.principal_asset_id,
                protocol_before + protocol_fee,
                protocol_after.get_script_pubkey(),
            ),
        ]);

        let scan = active
            .discover_partial_repayment(&tx, 0, 0, Some((lender_before, Some(protocol_before))))
            .expect("partial fee phase");
        assert_eq!(scan.amount_to_repay, amount_to_repay);
        assert_eq!(scan.debt_after, debt_after);
    }

    // Protocol fee must accrue cumulatively (floor(20*0.1) - floor(15*0.1) = 1), not per
    // installment (floor(5*0.1) = 0), or a second fee-phase repayment goes unrecognized.
    #[test]
    fn discover_partial_repayment_second_fee_installment() {
        let params = test_params();
        let total = params.offer_parameters.get_total_amount_to_repay();
        // First repayment of 15 already applied: fee repaid so far = 15, protocol fee = 1.
        let debt_before = total - 15;
        let active = LendingOffer::new_active(params, debt_before);
        let amount_to_repay = 5_u64;
        let debt_after = debt_before - amount_to_repay;
        let continuing = LendingOffer::new_active(params, debt_after);

        let lender_before = 14_u64;
        let protocol_before = 1_u64;
        // Correct, cumulative expectation: protocol fee goes 1 -> 2, lender absorbs the rest.
        let protocol_after_supplied = 2_u64;
        let lender_after_supplied = lender_before + (amount_to_repay - 1);

        let lender_after =
            AssetAuthVault::new_active(params.get_lender_vault_parameters(), lender_after_supplied);
        let protocol_after = AssetAuthVault::new_active(
            params.get_protocol_fee_vault_parameters(),
            protocol_after_supplied,
        );

        let tx = tx_with_outputs(vec![
            explicit_output(params.borrower_nft_asset_id, 1, script(&[0x51])),
            explicit_output(
                params.collateral_asset_id,
                3_000 - params.offer_parameters.get_collateral_for_principal(15 + 5),
                continuing.get_script_pubkey(),
            ),
            explicit_output(
                params.principal_asset_id,
                lender_after_supplied,
                lender_after.get_script_pubkey(),
            ),
            explicit_output(
                params.principal_asset_id,
                protocol_after_supplied,
                protocol_after.get_script_pubkey(),
            ),
        ]);

        let scan = active
            .discover_partial_repayment(&tx, 0, 0, Some((lender_before, Some(protocol_before))))
            .expect("second fee-phase repayment");
        assert_eq!(scan.amount_to_repay, amount_to_repay);
        assert_eq!(scan.debt_after, debt_after);
    }

    #[test]
    fn scan_full_repayment_no_repayments_phase() {
        let params = test_params();
        let total = params.offer_parameters.get_total_amount_to_repay();
        let active = LendingOffer::new_active(params, total);

        let protocol_fee = params.offer_parameters.get_total_protocol_fee();
        let lender_amount = total - protocol_fee;
        let lender_vault = AssetAuthVault::new_finalized(params.get_lender_vault_parameters());
        let protocol_vault =
            AssetAuthVault::new_finalized(params.get_protocol_fee_vault_parameters());

        // Full layout: burn nft@0, lender vault@1, protocol@2
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

        let scan = active.scan_full_repayment(&tx, 0, 0).expect("full");
        assert_eq!(scan.amount_to_repay, total);
        assert_eq!(scan.debt_after, 0);
        assert!(scan.continuing_offer_vout.is_none());
        assert_eq!(
            active.classify_tx(&tx),
            Some(LendingOfferTxKind::FullRepayment)
        );
    }

    #[test]
    fn scan_liquidation_lender_nft_burn() {
        let params = test_params();
        let total = params.offer_parameters.get_total_amount_to_repay();
        let active = LendingOffer::new_active(params, total);

        let tx = tx_with_outputs(vec![
            op_return_asset(params.lender_nft_asset_id),
            explicit_output(params.collateral_asset_id, 3_000, script(&[0x51])),
        ]);

        let scan = active.scan_liquidation(&tx).expect("liq");
        assert_eq!(scan.lender_nft_burn_vout, 0);
        assert_eq!(
            active.classify_tx(&tx),
            Some(LendingOfferTxKind::Liquidation)
        );
    }

    #[test]
    fn repayment_layout_offsets() {
        let partial = LendingOffer::partial_repayment_layout(0, 0);
        assert_eq!(partial.offer_input, 1);
        assert_eq!(partial.offer_output, Some(1));
        assert_eq!(partial.lender_vault_output, 2);
        assert_eq!(partial.protocol_fee_vault_output, Some(3));

        let full = LendingOffer::full_repayment_layout(0, 0);
        assert_eq!(full.offer_input, 1);
        assert_eq!(full.offer_output, None);
        assert_eq!(full.lender_vault_output, 1);
        assert_eq!(full.protocol_fee_vault_output, Some(2));
    }

    fn zero_protocol_fee_params() -> LendingOfferParameters {
        let mut params = test_params();
        params.offer_parameters.protocol_fee_rate = 0;
        params
    }

    #[test]
    fn discover_partial_repayment_zero_protocol_fee_creates_only_lender_vault() {
        let params = zero_protocol_fee_params();
        let total = params.offer_parameters.get_total_amount_to_repay();
        let active = LendingOffer::new_active(params, total);
        let amount_to_repay = 500_u64;
        let debt_after = total - amount_to_repay;
        let continuing = LendingOffer::new_active(params, debt_after);

        let lender_vault =
            AssetAuthVault::new_active(params.get_lender_vault_parameters(), amount_to_repay);

        // nft@0, offer@1, lender@2; the output at 3 is wallet change, not a protocol fee vault.
        let tx = tx_with_outputs(vec![
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
                amount_to_repay,
                lender_vault.get_script_pubkey(),
            ),
            explicit_output(params.principal_asset_id, 7, script(&[0x53])),
        ]);

        let scan = active
            .discover_partial_repayment(&tx, 0, 0, None)
            .expect("zero-fee partial");
        assert_eq!(scan.amount_to_repay, amount_to_repay);
        assert_eq!(scan.lender_vault_vout, 2);
        assert_eq!(scan.protocol_fee_vault_vout, None);
        assert_eq!(
            active.classify_tx(&tx),
            Some(LendingOfferTxKind::PartialRepayment)
        );
    }

    #[test]
    fn discover_partial_repayment_zero_protocol_fee_supplies_lender_vault() {
        let params = zero_protocol_fee_params();
        let total = params.offer_parameters.get_total_amount_to_repay();
        let debt_before = total - 500;
        let active = LendingOffer::new_active(params, debt_before);
        let amount_to_repay = 200_u64;
        let debt_after = debt_before - amount_to_repay;
        let continuing = LendingOffer::new_active(params, debt_after);

        let lender_after = params.get_lender_vault(debt_after);
        assert_eq!(lender_after.get_already_supplied_amount(), 700);

        let tx = tx_with_outputs(vec![
            explicit_output(params.borrower_nft_asset_id, 1, script(&[0x51])),
            explicit_output(
                params.collateral_asset_id,
                3_000 - params.offer_parameters.get_collateral_for_principal(700),
                continuing.get_script_pubkey(),
            ),
            explicit_output(
                params.principal_asset_id,
                700,
                lender_after.get_script_pubkey(),
            ),
        ]);

        // The protocol fee vault never exists, so no protocol amount is passed.
        let scan = active
            .discover_partial_repayment(&tx, 0, 0, Some((500, None)))
            .expect("zero-fee second partial");
        assert_eq!(scan.amount_to_repay, amount_to_repay);
        assert_eq!(scan.protocol_fee_vault_vout, None);
    }

    #[test]
    fn scan_full_repayment_zero_protocol_fee_has_no_protocol_vault() {
        let params = zero_protocol_fee_params();
        let total = params.offer_parameters.get_total_amount_to_repay();
        let active = LendingOffer::new_active(params, total);
        let lender_vault = AssetAuthVault::new_finalized(params.get_lender_vault_parameters());

        // burn nft@0, lender vault@1
        let tx = tx_with_outputs(vec![
            op_return_asset(params.borrower_nft_asset_id),
            explicit_output(
                params.principal_asset_id,
                total,
                lender_vault.get_script_pubkey(),
            ),
        ]);

        let scan = active
            .scan_full_repayment(&tx, 0, 0)
            .expect("zero-fee full");
        assert_eq!(scan.amount_to_repay, total);
        assert_eq!(scan.lender_vault_vout, 1);
        assert_eq!(scan.protocol_fee_vault_vout, None);
    }

    // floor(5 * 0.1) = 0: the first repayment carries no protocol share, so the protocol fee vault
    // is created only by the next one, floor(10 * 0.1) - floor(5 * 0.1) = 1.
    #[test]
    fn discover_partial_repayment_creates_protocol_vault_after_rounded_out_share() {
        let params = test_params();
        let total = params.offer_parameters.get_total_amount_to_repay();
        let debt_before = total - 5;
        let active = LendingOffer::new_active(params, debt_before);
        assert!(params.offer_parameters.has_lender_vault(debt_before));
        assert!(!params.offer_parameters.has_protocol_fee_vault(debt_before));

        let amount_to_repay = 5_u64;
        let debt_after = debt_before - amount_to_repay;
        let continuing = LendingOffer::new_active(params, debt_after);

        let lender_after = params.get_lender_vault(debt_after);
        let protocol_after = params.get_protocol_fee_vault(debt_after);
        assert_eq!(lender_after.get_already_supplied_amount(), 9);
        assert_eq!(protocol_after.get_already_supplied_amount(), 1);

        let tx = tx_with_outputs(vec![
            explicit_output(params.borrower_nft_asset_id, 1, script(&[0x51])),
            explicit_output(
                params.collateral_asset_id,
                3_000 - params.offer_parameters.get_collateral_for_principal(10),
                continuing.get_script_pubkey(),
            ),
            explicit_output(
                params.principal_asset_id,
                9,
                lender_after.get_script_pubkey(),
            ),
            explicit_output(
                params.principal_asset_id,
                1,
                protocol_after.get_script_pubkey(),
            ),
        ]);

        let scan = active
            .discover_partial_repayment(&tx, 0, 0, Some((5, None)))
            .expect("protocol vault created by second repayment");
        assert_eq!(scan.amount_to_repay, amount_to_repay);
        assert_eq!(scan.protocol_fee_vault_vout, Some(3));
    }
}
