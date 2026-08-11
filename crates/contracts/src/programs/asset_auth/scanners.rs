use simplex::simplicityhl::elements::{AssetId, Script, Transaction, TxOut};

use crate::programs::asset_auth::AssetAuth;
use crate::programs::program::SimplexProgram;
use crate::utils::{TxOutFilter, find_unique_vout, has_matching_vout};

/// UTXO role relative to a known [`AssetAuth`] instance.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssetAuthUtxoKind {
    /// Covenant program UTXO (`script_pubkey == auth.get_script_pubkey()`).
    Program,
}

/// High-level asset-auth transaction kinds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssetAuthTxKind {
    /// Unique program create output present.
    Creation,
    /// Program spent with no continuing covenant; auth NFT transferred (non-burn).
    UnlockTransfer,
    /// Program spent with no continuing covenant; auth NFT burned (OP_RETURN).
    UnlockBurn,
}

/// Layout of a successful unlock (program spent, auth NFT moved or burned).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssetAuthUnlockScan {
    pub auth_nft_vout: u32,
    pub auth_nft_script_pubkey: Script,
    pub burned: bool,
}

/// Layout of a program create with a known locked asset.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AssetAuthCreationScan {
    pub program_vout: u32,
    pub locked_amount: u64,
}

impl AssetAuth {
    /// Whether `output` is this auth program instance (same script, non-OP_RETURN, amount > 0).
    ///
    /// Locked asset is not part of program params — only the covenant script is checked here.
    pub fn matches_output(&self, output: &TxOut) -> bool {
        is_program_utxo(output) && output.script_pubkey == self.get_script_pubkey()
    }

    /// Classify an output as this program instance.
    pub fn classify_output(&self, output: &TxOut) -> Option<AssetAuthUtxoKind> {
        self.matches_output(output)
            .then_some(AssetAuthUtxoKind::Program)
    }

    /// Unique output matching this program script.
    pub fn find_unique_vout_matching(&self, tx: &Transaction) -> Option<(u32, u64)> {
        let script = self.get_script_pubkey();

        find_unique_vout(
            tx,
            TxOutFilter::new()
                .min_amount(1)
                .script_pubkey(&script)
                .require_op_return(false),
        )
    }

    /// Alias for creation scans: unique created program output.
    pub fn find_unique_created_vout(&self, tx: &Transaction) -> Option<(u32, u64)> {
        self.find_unique_vout_matching(tx)
    }

    /// Unique program output that also carries `locked_asset_id` (optional exact `amount`).
    pub fn find_unique_locked_vout(
        &self,
        tx: &Transaction,
        locked_asset_id: AssetId,
        amount: Option<u64>,
    ) -> Option<(u32, u64)> {
        let script = self.get_script_pubkey();
        let mut filter = TxOutFilter::new()
            .asset(locked_asset_id)
            .script_pubkey(&script)
            .require_op_return(false);

        filter = match amount {
            Some(amount) => filter.amount(amount),
            None => filter.min_amount(1),
        };

        find_unique_vout(tx, filter)
    }

    /// Creation layout for a known locked asset (+ optional exact amount).
    pub fn scan_creation(
        &self,
        tx: &Transaction,
        locked_asset_id: AssetId,
        amount: Option<u64>,
    ) -> Option<AssetAuthCreationScan> {
        let (program_vout, locked_amount) =
            self.find_unique_locked_vout(tx, locked_asset_id, amount)?;

        Some(AssetAuthCreationScan {
            program_vout,
            locked_amount,
        })
    }

    /// Unlock layout: no continuing program; unique auth NFT transfer or burn.
    pub fn scan_unlock(&self, tx: &Transaction) -> Option<AssetAuthUnlockScan> {
        if self.find_unique_vout_matching(tx).is_some()
            || has_matching_program_vout(tx, &self.get_script_pubkey())
        {
            return None;
        }

        let params = self.get_parameters();
        let auth_nft_vout = find_unique_vout(
            tx,
            TxOutFilter::new()
                .asset(params.asset_id)
                .amount(params.asset_amount)
                .require_op_return(params.with_asset_burn),
        )
        .map(|(vout, _)| vout)?;

        let auth_nft_script_pubkey = tx.output.get(auth_nft_vout as usize)?.script_pubkey.clone();

        Some(AssetAuthUnlockScan {
            auth_nft_vout,
            auth_nft_script_pubkey,
            burned: params.with_asset_burn,
        })
    }

    /// Classify a tx related to this auth program instance.
    pub fn classify_tx(&self, tx: &Transaction) -> Option<AssetAuthTxKind> {
        if self.find_unique_vout_matching(tx).is_some() {
            return Some(AssetAuthTxKind::Creation);
        }

        let unlock = self.scan_unlock(tx)?;

        Some(if unlock.burned {
            AssetAuthTxKind::UnlockBurn
        } else {
            AssetAuthTxKind::UnlockTransfer
        })
    }
}

fn is_program_utxo(output: &TxOut) -> bool {
    let Some(amount) = output.value.explicit() else {
        return false;
    };

    amount > 0 && !output.script_pubkey.is_op_return()
}

fn has_matching_program_vout(tx: &Transaction, script_pubkey: &Script) -> bool {
    has_matching_vout(
        tx,
        TxOutFilter::new()
            .min_amount(1)
            .script_pubkey(script_pubkey)
            .require_op_return(false),
    )
}

#[cfg(test)]
mod tests {
    use super::{AssetAuthTxKind, AssetAuthUtxoKind};
    use crate::programs::asset_auth::{AssetAuth, AssetAuthParameters};
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

    fn op_return_asset(asset_id: AssetId, amount: u64) -> TxOut {
        let mut output = TxOut {
            script_pubkey: Script::new_op_return(b"burn"),
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

    fn test_params(with_asset_burn: bool) -> AssetAuthParameters {
        AssetAuthParameters {
            asset_id: asset(2),
            asset_amount: 1,
            with_asset_burn,
            network: SimplicityNetwork::default_regtest(),
        }
    }

    #[test]
    fn classify_output_program() {
        let auth = AssetAuth::new(test_params(false));
        let locked = asset(9);

        assert_eq!(
            auth.classify_output(&explicit_output(locked, 100, auth.get_script_pubkey())),
            Some(AssetAuthUtxoKind::Program)
        );
        assert_eq!(
            auth.classify_output(&explicit_output(locked, 100, script(&[0x51]))),
            None
        );
    }

    #[test]
    fn find_unique_locked_vout_and_scan_creation() {
        let auth = AssetAuth::new(test_params(false));
        let locked = asset(7);
        let tx = tx_with_outputs(vec![
            explicit_output(asset(1), 1, script(&[0x51])),
            explicit_output(locked, 10_000, auth.get_script_pubkey()),
        ]);

        assert_eq!(auth.find_unique_created_vout(&tx), Some((1, 10_000)));
        let scan = auth
            .scan_creation(&tx, locked, Some(10_000))
            .expect("creation");
        assert_eq!(scan.program_vout, 1);
        assert_eq!(scan.locked_amount, 10_000);
        assert_eq!(auth.classify_tx(&tx), Some(AssetAuthTxKind::Creation));
    }

    #[test]
    fn scan_unlock_transfer() {
        let auth = AssetAuth::new(test_params(false));
        let params = *auth.get_parameters();
        let tx = tx_with_outputs(vec![
            explicit_output(params.asset_id, 1, script(&[0x52])),
            explicit_output(asset(9), 50, script(&[0x53])),
        ]);

        let scan = auth.scan_unlock(&tx).expect("unlock");
        assert_eq!(scan.auth_nft_vout, 0);
        assert!(!scan.burned);
        assert_eq!(auth.classify_tx(&tx), Some(AssetAuthTxKind::UnlockTransfer));
    }

    #[test]
    fn scan_unlock_burn() {
        let auth = AssetAuth::new(test_params(true));
        let params = *auth.get_parameters();
        let tx = tx_with_outputs(vec![
            op_return_asset(params.asset_id, 1),
            explicit_output(asset(9), 50, script(&[0x53])),
        ]);

        let scan = auth.scan_unlock(&tx).expect("unlock burn");
        assert_eq!(scan.auth_nft_vout, 0);
        assert!(scan.burned);
        assert_eq!(auth.classify_tx(&tx), Some(AssetAuthTxKind::UnlockBurn));
    }

    #[test]
    fn unlock_rejects_continuing_program() {
        let auth = AssetAuth::new(test_params(false));
        let params = *auth.get_parameters();
        let tx = tx_with_outputs(vec![
            explicit_output(params.asset_id, 1, script(&[0x52])),
            explicit_output(asset(9), 50, auth.get_script_pubkey()),
        ]);

        assert!(auth.scan_unlock(&tx).is_none());
        assert_eq!(auth.classify_tx(&tx), Some(AssetAuthTxKind::Creation));
    }

    #[test]
    fn ambiguous_program_outs_return_none() {
        let auth = AssetAuth::new(test_params(false));
        let locked = asset(7);
        let tx = tx_with_outputs(vec![
            explicit_output(locked, 10, auth.get_script_pubkey()),
            explicit_output(locked, 20, auth.get_script_pubkey()),
        ]);

        assert!(auth.find_unique_vout_matching(&tx).is_none());
        assert!(auth.scan_creation(&tx, locked, None).is_none());
    }
}
