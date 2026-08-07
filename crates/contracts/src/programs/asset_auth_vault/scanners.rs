use simplex::simplicityhl::elements::{AssetId, Transaction, TxOut};

use crate::programs::asset_auth_vault::AssetAuthVault;
use crate::programs::program::SimplexProgram;

/// Vault covenant UTXO roles relative to a known vault instance / params.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssetAuthVaultUtxoKind {
    /// Active vault for a known `already_supplied` storage value.
    Active { already_supplied: u64 },
    /// Finalized vault (`is_active = false`, `already_supplied = supply_goal`).
    Finalized,
}

/// High-level vault spend kinds (covenant witness paths).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssetAuthVaultTxKind {
    Supply,
    FinalSupply,
    WithdrawPart,
    WithdrawAll,
}

/// Layout of a partial supply that keeps the vault active.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AssetAuthVaultSupplyScan {
    pub vault_vout: u32,
    pub already_supplied_after: u64,
    pub vault_amount_after: u64,
}

/// Layout of a final supply that finalizes the vault.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AssetAuthVaultFinalSupplyScan {
    pub vault_vout: u32,
    pub vault_amount_after: u64,
}

/// Layout of a partial withdraw (same script / already_supplied, lower amount).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AssetAuthVaultWithdrawPartScan {
    pub vault_vout: u32,
    pub already_supplied: u64,
    pub vault_amount_after: u64,
}

impl AssetAuthVault {
    /// Whether `output` is this vault instance (same vault asset + script_pubkey).
    pub fn matches_output(&self, output: &TxOut) -> bool {
        is_vault_asset_utxo(output, self.get_parameters().vault_asset_id)
            && output.script_pubkey == self.get_script_pubkey()
    }

    /// Classify an output as this vault's active/finalized form, or params-finalized.
    pub fn classify_output(&self, output: &TxOut) -> Option<AssetAuthVaultUtxoKind> {
        let params = *self.get_parameters();

        if !is_vault_asset_utxo(output, params.vault_asset_id) {
            return None;
        }

        if output.script_pubkey == self.get_script_pubkey() {
            return Some(if self.is_active_offer() {
                AssetAuthVaultUtxoKind::Active {
                    already_supplied: self.get_already_supplied_amount(),
                }
            } else {
                AssetAuthVaultUtxoKind::Finalized
            });
        }

        // Active instances can also recognize the finalized script for these params.
        if self.is_active_offer() {
            let finalized = AssetAuthVault::new_finalized(params);
            if output.script_pubkey == finalized.get_script_pubkey() {
                return Some(AssetAuthVaultUtxoKind::Finalized);
            }
        }

        None
    }

    /// Unique output matching this vault instance's script + vault asset.
    pub fn find_unique_vout_matching(&self, tx: &Transaction) -> Option<(u32, u64)> {
        find_unique_matching_vout(
            tx,
            self.get_parameters().vault_asset_id,
            &self.get_script_pubkey(),
        )
    }

    /// Alias for creation scans: find the unique created vault output for `self`.
    pub fn find_unique_created_vout(&self, tx: &Transaction) -> Option<(u32, u64)> {
        self.find_unique_vout_matching(tx)
    }

    /// Partial supply to `already_supplied + amount_to_supply` (must stay below goal).
    pub fn scan_supply_to(
        &self,
        tx: &Transaction,
        amount_to_supply: u64,
    ) -> Option<AssetAuthVaultSupplyScan> {
        if !self.is_active_offer() || amount_to_supply == 0 {
            return None;
        }

        let params = *self.get_parameters();
        let already_supplied = self.get_already_supplied_amount();
        let amount_to_goal = params.supply_goal.checked_sub(already_supplied)?;
        if amount_to_supply >= amount_to_goal {
            return None;
        }

        let already_supplied_after = already_supplied + amount_to_supply;
        let expected = AssetAuthVault::new_active(params, already_supplied_after);
        let (vault_vout, vault_amount_after) = expected.find_unique_vout_matching(tx)?;

        Some(AssetAuthVaultSupplyScan {
            vault_vout,
            already_supplied_after,
            vault_amount_after,
        })
    }

    /// Final supply: continuing output is the finalized vault for these params.
    pub fn scan_final_supply(&self, tx: &Transaction) -> Option<AssetAuthVaultFinalSupplyScan> {
        if !self.is_active_offer() {
            return None;
        }

        let finalized = AssetAuthVault::new_finalized(*self.get_parameters());
        let (vault_vout, vault_amount_after) = finalized.find_unique_vout_matching(tx)?;

        Some(AssetAuthVaultFinalSupplyScan {
            vault_vout,
            vault_amount_after,
        })
    }

    /// Partial withdraw: unique continuing output with the **same** script as `self`.
    pub fn scan_withdraw_part(&self, tx: &Transaction) -> Option<AssetAuthVaultWithdrawPartScan> {
        if !self.is_active_offer() {
            return None;
        }

        let (vault_vout, vault_amount_after) = self.find_unique_vout_matching(tx)?;

        Some(AssetAuthVaultWithdrawPartScan {
            vault_vout,
            already_supplied: self.get_already_supplied_amount(),
            vault_amount_after,
        })
    }

    /// Finalized vault spent with no continuing vault covenant output.
    pub fn is_withdraw_all(&self, tx: &Transaction) -> bool {
        if !self.is_finalized_offer() {
            return false;
        }

        self.find_unique_vout_matching(tx).is_none()
            && !has_any_matching_vout(
                tx,
                self.get_parameters().vault_asset_id,
                &self.get_script_pubkey(),
            )
    }

    /// Classify a spend of `self` without a known supply amount.
    ///
    /// `Supply` cannot be detected here (needs `amount_to_supply`); use
    /// [`Self::classify_supply_tx`].
    pub fn classify_tx(&self, tx: &Transaction) -> Option<AssetAuthVaultTxKind> {
        if self.is_finalized_offer() {
            return self
                .is_withdraw_all(tx)
                .then_some(AssetAuthVaultTxKind::WithdrawAll);
        }

        // Prefer FinalSupply over WithdrawPart when both could match — they cannot:
        // FinalSupply changes script; WithdrawPart keeps it.
        if self.scan_final_supply(tx).is_some() {
            return Some(AssetAuthVaultTxKind::FinalSupply);
        }

        if self.scan_withdraw_part(tx).is_some() {
            return Some(AssetAuthVaultTxKind::WithdrawPart);
        }

        None
    }

    /// Classify a supply spend of active `self` for a known `amount_to_supply`.
    pub fn classify_supply_tx(
        &self,
        tx: &Transaction,
        amount_to_supply: u64,
    ) -> Option<AssetAuthVaultTxKind> {
        if !self.is_active_offer() || amount_to_supply == 0 {
            return None;
        }

        let already_supplied = self.get_already_supplied_amount();
        let amount_to_goal = self
            .get_parameters()
            .supply_goal
            .checked_sub(already_supplied)?;

        if amount_to_supply == amount_to_goal {
            return self
                .scan_final_supply(tx)
                .map(|_| AssetAuthVaultTxKind::FinalSupply);
        }

        if amount_to_supply < amount_to_goal {
            return self
                .scan_supply_to(tx, amount_to_supply)
                .map(|_| AssetAuthVaultTxKind::Supply);
        }

        None
    }
}

fn is_vault_asset_utxo(output: &TxOut, vault_asset_id: AssetId) -> bool {
    let (Some(asset_id), Some(amount)) = (output.asset.explicit(), output.value.explicit()) else {
        return false;
    };

    asset_id == vault_asset_id && amount > 0 && !output.script_pubkey.is_op_return()
}

fn find_unique_matching_vout(
    tx: &Transaction,
    vault_asset_id: AssetId,
    script_pubkey: &simplex::simplicityhl::elements::Script,
) -> Option<(u32, u64)> {
    let matches: Vec<(u32, u64)> = tx
        .output
        .iter()
        .enumerate()
        .filter_map(|(vout, output)| {
            if !is_vault_asset_utxo(output, vault_asset_id) {
                return None;
            }
            if output.script_pubkey != *script_pubkey {
                return None;
            }
            Some((vout as u32, output.value.explicit()?))
        })
        .collect();

    match matches.as_slice() {
        [(vout, amount)] => Some((*vout, *amount)),
        _ => None,
    }
}

fn has_any_matching_vout(
    tx: &Transaction,
    vault_asset_id: AssetId,
    script_pubkey: &simplex::simplicityhl::elements::Script,
) -> bool {
    tx.output.iter().any(|output| {
        is_vault_asset_utxo(output, vault_asset_id) && output.script_pubkey == *script_pubkey
    })
}

#[cfg(test)]
mod tests {
    use super::{AssetAuthVaultTxKind, AssetAuthVaultUtxoKind, is_vault_asset_utxo};
    use crate::programs::asset_auth_vault::{AssetAuthVault, AssetAuthVaultParameters};
    use crate::programs::program::SimplexProgram;
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

    fn test_params(supply_goal: u64) -> AssetAuthVaultParameters {
        AssetAuthVaultParameters {
            vault_asset_id: asset(1),
            keeper_asset_id: asset(2),
            supplier_asset_id: asset(3),
            supply_goal,
            with_keeper_asset_burn: true,
            with_supplier_asset_burn: true,
            network: SimplicityNetwork::default_regtest(),
        }
    }

    #[test]
    fn classify_output_active_and_finalized() {
        let params = test_params(1_000);
        let active = AssetAuthVault::new_active(params, 100);
        let vault_asset = params.vault_asset_id;

        assert_eq!(
            active.classify_output(&explicit_output(
                vault_asset,
                50, // amount may differ from already_supplied after withdraw
                active.get_script_pubkey(),
            )),
            Some(AssetAuthVaultUtxoKind::Active {
                already_supplied: 100
            })
        );

        let finalized = AssetAuthVault::new_finalized(params);
        assert_eq!(
            active.classify_output(&explicit_output(
                vault_asset,
                1_000,
                finalized.get_script_pubkey(),
            )),
            Some(AssetAuthVaultUtxoKind::Finalized)
        );

        assert_eq!(
            active.classify_output(&explicit_output(asset(9), 100, active.get_script_pubkey())),
            None
        );
    }

    #[test]
    fn find_unique_created_vout() {
        let params = test_params(500);
        let vault = AssetAuthVault::new_active(params, 40);
        let tx = tx_with_outputs(vec![
            explicit_output(asset(9), 1, script(&[0x51])),
            explicit_output(params.vault_asset_id, 40, vault.get_script_pubkey()),
        ]);

        assert_eq!(vault.find_unique_created_vout(&tx), Some((1, 40)));
    }

    #[test]
    fn scan_withdraw_part_same_script() {
        let params = test_params(500);
        let vault = AssetAuthVault::new_active(params, 200);
        // After withdraw, amount dropped but script (already_supplied) unchanged.
        let tx = tx_with_outputs(vec![explicit_output(
            params.vault_asset_id,
            150,
            vault.get_script_pubkey(),
        )]);

        let scan = vault.scan_withdraw_part(&tx).expect("withdraw part");
        assert_eq!(scan.vault_vout, 0);
        assert_eq!(scan.already_supplied, 200);
        assert_eq!(scan.vault_amount_after, 150);
        assert_eq!(
            vault.classify_tx(&tx),
            Some(AssetAuthVaultTxKind::WithdrawPart)
        );
    }

    #[test]
    fn scan_supply_to_and_classify_supply_tx() {
        let params = test_params(1_000);
        let vault = AssetAuthVault::new_active(params, 100);
        let after = AssetAuthVault::new_active(params, 250);
        let tx = tx_with_outputs(vec![explicit_output(
            params.vault_asset_id,
            250,
            after.get_script_pubkey(),
        )]);

        let scan = vault.scan_supply_to(&tx, 150).expect("supply");
        assert_eq!(scan.vault_vout, 0);
        assert_eq!(scan.already_supplied_after, 250);
        assert_eq!(
            vault.classify_supply_tx(&tx, 150),
            Some(AssetAuthVaultTxKind::Supply)
        );
        // Without amount, supply is not classified.
        assert_eq!(vault.classify_tx(&tx), None);
    }

    #[test]
    fn scan_final_supply() {
        let params = test_params(1_000);
        let vault = AssetAuthVault::new_active(params, 800);
        let finalized = AssetAuthVault::new_finalized(params);
        let tx = tx_with_outputs(vec![explicit_output(
            params.vault_asset_id,
            1_000,
            finalized.get_script_pubkey(),
        )]);

        let scan = vault.scan_final_supply(&tx).expect("final supply");
        assert_eq!(scan.vault_vout, 0);
        assert_eq!(
            vault.classify_supply_tx(&tx, 200),
            Some(AssetAuthVaultTxKind::FinalSupply)
        );
        assert_eq!(
            vault.classify_tx(&tx),
            Some(AssetAuthVaultTxKind::FinalSupply)
        );
    }

    #[test]
    fn withdraw_all_on_finalized_without_continuation() {
        let params = test_params(1_000);
        let vault = AssetAuthVault::new_finalized(params);
        let tx = tx_with_outputs(vec![explicit_output(
            params.vault_asset_id,
            1_000,
            script(&[0x99]), // not vault script — e.g. keeper destination
        )]);

        assert!(vault.is_withdraw_all(&tx));
        assert_eq!(
            vault.classify_tx(&tx),
            Some(AssetAuthVaultTxKind::WithdrawAll)
        );
    }

    #[test]
    fn ambiguous_matching_outs_return_none() {
        let params = test_params(500);
        let vault = AssetAuthVault::new_active(params, 10);
        let spk = vault.get_script_pubkey();
        let tx = tx_with_outputs(vec![
            explicit_output(params.vault_asset_id, 10, spk.clone()),
            explicit_output(params.vault_asset_id, 10, spk),
        ]);

        assert!(vault.find_unique_vout_matching(&tx).is_none());
        assert!(vault.scan_withdraw_part(&tx).is_none());
    }

    #[test]
    fn is_vault_asset_utxo_rejects_op_return_and_zero() {
        let vault_asset = asset(1);
        assert!(is_vault_asset_utxo(
            &explicit_output(vault_asset, 1, script(&[0x51])),
            vault_asset
        ));
        assert!(!is_vault_asset_utxo(
            &explicit_output(vault_asset, 0, script(&[0x51])),
            vault_asset
        ));

        let mut op_return = TxOut {
            script_pubkey: Script::new_op_return(b"burn"),
            ..Default::default()
        };
        op_return.asset = confidential::Asset::Explicit(vault_asset);
        op_return.value = confidential::Value::Explicit(1);
        assert!(!is_vault_asset_utxo(&op_return, vault_asset));
    }
}
