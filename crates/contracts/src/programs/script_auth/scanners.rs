use simplex::simplicityhl::elements::{AssetId, Script, Transaction, TxOut};
use simplex::utils::hash_script;

use crate::programs::program::SimplexProgram;
use crate::programs::script_auth::ScriptAuth;
use crate::utils::{TxOutFilter, find_unique_vout, has_matching_vout};

/// UTXO role relative to a known [`ScriptAuth`] instance.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScriptAuthUtxoKind {
    /// Covenant program UTXO (`script_pubkey == auth.get_script_pubkey()`).
    Program,
}

/// High-level script-auth transaction kinds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScriptAuthTxKind {
    /// Unique program create output present.
    Creation,
    /// Program spent with no continuing covenant output.
    Unlock,
}

/// Layout of a program create with a known locked asset.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScriptAuthCreationScan {
    pub program_vout: u32,
    pub locked_amount: u64,
}

/// Marker that a tx looks like an unlock of this program (no continuing covenant out).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScriptAuthUnlockScan;

impl ScriptAuth {
    /// Whether `output` is this script-auth program instance (same script, non-OP_RETURN, amount > 0).
    ///
    /// Locked asset is not part of program params — only the covenant script is checked here.
    pub fn matches_output(&self, output: &TxOut) -> bool {
        is_program_utxo(output) && output.script_pubkey == self.get_script_pubkey()
    }

    /// Whether `script` is the authorizing script committed in `params.script_hash`.
    pub fn matches_authorizing_script(&self, script: &Script) -> bool {
        hash_script(script) == self.get_parameters().script_hash
    }

    /// Classify an output as this program instance.
    pub fn classify_output(&self, output: &TxOut) -> Option<ScriptAuthUtxoKind> {
        self.matches_output(output)
            .then_some(ScriptAuthUtxoKind::Program)
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
    ) -> Option<ScriptAuthCreationScan> {
        let (program_vout, locked_amount) =
            self.find_unique_locked_vout(tx, locked_asset_id, amount)?;

        Some(ScriptAuthCreationScan {
            program_vout,
            locked_amount,
        })
    }

    /// Unlock without prevouts: no continuing program output.
    ///
    /// Does **not** verify the authorizing input script hash (needs a prevout). Use
    /// [`Self::scan_unlock_with_authorizing_script`] when that script is known.
    pub fn scan_unlock(&self, tx: &Transaction) -> Option<ScriptAuthUnlockScan> {
        if self.has_continuing_program(tx) {
            return None;
        }

        Some(ScriptAuthUnlockScan)
    }

    /// Unlock plus check that `authorizing_prevout_script` matches `params.script_hash`.
    ///
    /// Pass the prevout script of the input the covenant authorizes (looked up outside
    /// this scanner — bare [`Transaction`] inputs do not carry it).
    pub fn scan_unlock_with_authorizing_script(
        &self,
        tx: &Transaction,
        authorizing_prevout_script: &Script,
    ) -> Option<ScriptAuthUnlockScan> {
        if !self.matches_authorizing_script(authorizing_prevout_script) {
            return None;
        }

        self.scan_unlock(tx)
    }

    /// Classify a tx related to this script-auth program instance.
    ///
    /// `Unlock` uses the weak [`Self::scan_unlock`] (no authorizing-script check).
    pub fn classify_tx(&self, tx: &Transaction) -> Option<ScriptAuthTxKind> {
        if self.find_unique_vout_matching(tx).is_some() {
            return Some(ScriptAuthTxKind::Creation);
        }

        self.scan_unlock(tx).map(|_| ScriptAuthTxKind::Unlock)
    }

    fn has_continuing_program(&self, tx: &Transaction) -> bool {
        let script = self.get_script_pubkey();

        has_matching_vout(
            tx,
            TxOutFilter::new()
                .min_amount(1)
                .script_pubkey(&script)
                .require_op_return(false),
        )
    }
}

fn is_program_utxo(output: &TxOut) -> bool {
    let Some(amount) = output.value.explicit() else {
        return false;
    };

    amount > 0 && !output.script_pubkey.is_op_return()
}

#[cfg(test)]
mod tests {
    use super::{ScriptAuthTxKind, ScriptAuthUtxoKind};
    use crate::programs::program::SimplexProgram;
    use crate::programs::script_auth::{ScriptAuth, ScriptAuthParameters};
    use simplex::{
        provider::SimplicityNetwork,
        simplicityhl::elements::{
            AssetId, LockTime, Script, Transaction, TxIn, TxOut, confidential,
        },
        utils::hash_script,
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

    fn tx_with_io(inputs: usize, outputs: Vec<TxOut>) -> Transaction {
        Transaction {
            version: 2,
            lock_time: LockTime::ZERO,
            input: (0..inputs)
                .map(|_| TxIn {
                    previous_output: Default::default(),
                    ..Default::default()
                })
                .collect(),
            output: outputs,
        }
    }

    fn test_auth(authorizing_script: &Script) -> ScriptAuth {
        ScriptAuth::new(ScriptAuthParameters {
            script_hash: hash_script(authorizing_script),
            network: SimplicityNetwork::default_regtest(),
        })
    }

    #[test]
    fn classify_output_program() {
        let auth_script = script(&[0x51, 0x52]);
        let auth = test_auth(&auth_script);
        let locked = asset(9);

        assert_eq!(
            auth.classify_output(&explicit_output(locked, 100, auth.get_script_pubkey())),
            Some(ScriptAuthUtxoKind::Program)
        );
        assert_eq!(
            auth.classify_output(&explicit_output(locked, 100, script(&[0x51]))),
            None
        );
    }

    #[test]
    fn find_unique_locked_vout_and_scan_creation() {
        let auth = test_auth(&script(&[0x51]));
        let locked = asset(7);
        let tx = tx_with_io(
            1,
            vec![
                explicit_output(asset(1), 1, script(&[0x51])),
                explicit_output(locked, 500, auth.get_script_pubkey()),
            ],
        );

        assert_eq!(auth.find_unique_created_vout(&tx), Some((1, 500)));
        let scan = auth
            .scan_creation(&tx, locked, Some(500))
            .expect("creation");
        assert_eq!(scan.program_vout, 1);
        assert_eq!(scan.locked_amount, 500);
        assert_eq!(auth.classify_tx(&tx), Some(ScriptAuthTxKind::Creation));
    }

    #[test]
    fn scan_unlock_without_continuing_program() {
        let auth = test_auth(&script(&[0x51]));
        let tx = tx_with_io(1, vec![explicit_output(asset(9), 50, script(&[0x53]))]);

        assert!(auth.scan_unlock(&tx).is_some());
        assert_eq!(auth.classify_tx(&tx), Some(ScriptAuthTxKind::Unlock));
    }

    #[test]
    fn unlock_rejects_continuing_program() {
        let auth = test_auth(&script(&[0x51]));
        let tx = tx_with_io(
            1,
            vec![explicit_output(asset(9), 50, auth.get_script_pubkey())],
        );

        assert!(auth.scan_unlock(&tx).is_none());
        assert_eq!(auth.classify_tx(&tx), Some(ScriptAuthTxKind::Creation));
    }

    #[test]
    fn scan_unlock_with_authorizing_script() {
        let authorizing = script(&[0x51, 0x61]);
        let auth = test_auth(&authorizing);
        let tx = tx_with_io(2, vec![explicit_output(asset(9), 50, script(&[0x53]))]);

        assert!(auth.matches_authorizing_script(&authorizing));
        assert!(!auth.matches_authorizing_script(&script(&[0x99])));

        assert!(
            auth.scan_unlock_with_authorizing_script(&tx, &authorizing)
                .is_some()
        );
        assert!(
            auth.scan_unlock_with_authorizing_script(&tx, &script(&[0x99]))
                .is_none()
        );
    }

    #[test]
    fn ambiguous_program_outs_return_none() {
        let auth = test_auth(&script(&[0x51]));
        let locked = asset(7);
        let tx = tx_with_io(
            1,
            vec![
                explicit_output(locked, 10, auth.get_script_pubkey()),
                explicit_output(locked, 20, auth.get_script_pubkey()),
            ],
        );

        assert!(auth.find_unique_vout_matching(&tx).is_none());
        assert!(auth.scan_creation(&tx, locked, None).is_none());
    }
}
