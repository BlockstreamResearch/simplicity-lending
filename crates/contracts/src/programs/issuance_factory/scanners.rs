use simplex::provider::SimplicityNetwork;
use simplex::simplicityhl::elements::{AssetId, Script, Transaction, TxOut, Txid};

use crate::programs::issuance_factory::{
    IssuanceFactory, IssuanceFactoryError, IssuanceFactoryParameters,
};
use crate::programs::program::{MetadataProgram, SimplexProgram};

use crate::utils::op_return_payload;

/// UTXO roles that an issuance factory can classify for its factory asset.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IssuanceFactoryUtxoKind {
    /// Covenant program UTXO (`script_pubkey == factory.get_script_pubkey()`).
    Program,
    /// Auth / keeper UTXO of the same factory asset (any other non-OP_RETURN script).
    Auth,
}

/// High-level issuance-factory transaction kinds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IssuanceFactoryTxKind {
    Creation,
    AssetsIssuance,
    FactoryRemoval,
}

/// Layout of a successful factory creation transaction.
#[derive(Debug, Clone)]
pub struct IssuanceFactoryCreationScan {
    pub program_vout: u32,
    pub auth_vout: u32,
    pub auth_script_pubkey: Script,
}

/// Parsed factory creation: reconstructed factory + asset + output layout.
pub struct IssuanceFactoryCreation {
    pub factory: IssuanceFactory,
    pub factory_asset_id: AssetId,
    pub program_vout: u32,
    pub auth_vout: u32,
    pub auth_script_pubkey: Script,
}

/// Layout of a continuing assets-issuance spend.
#[derive(Debug, Clone)]
pub struct IssuanceFactoryAssetsIssuanceScan {
    pub program_vout: u32,
    pub auth_vouts: Vec<(u32, Script)>,
}

impl IssuanceFactory {
    /// Parse an issuance-factory creation transaction.
    ///
    /// Reconstructs [`IssuanceFactory`] from creation metadata and returns the
    /// program/auth output layout.
    pub fn try_from_tx(
        tx: &Transaction,
        network: SimplicityNetwork,
    ) -> Result<IssuanceFactoryCreation, IssuanceFactoryError> {
        let txid = tx.txid();
        let factory = Self::factory_from_creation_metadata(tx, network, txid)?;
        let factory_asset_id = factory
            .find_unique_program_asset(tx)
            .ok_or(IssuanceFactoryError::NotAnIssuanceFactoryCreationTx(txid))?;

        let scan = factory
            .scan_creation(tx, factory_asset_id)
            .ok_or(IssuanceFactoryError::NotAnIssuanceFactoryCreationTx(txid))?;

        Ok(IssuanceFactoryCreation {
            factory,
            factory_asset_id,
            program_vout: scan.program_vout,
            auth_vout: scan.auth_vout,
            auth_script_pubkey: scan.auth_script_pubkey,
        })
    }

    /// Classify a single output relative to this factory and `factory_asset_id`.
    pub fn classify_output(
        &self,
        output: &TxOut,
        factory_asset_id: AssetId,
    ) -> Option<IssuanceFactoryUtxoKind> {
        if !is_factory_asset_utxo(output, factory_asset_id) {
            return None;
        }

        if output.script_pubkey == self.get_script_pubkey() {
            Some(IssuanceFactoryUtxoKind::Program)
        } else {
            Some(IssuanceFactoryUtxoKind::Auth)
        }
    }

    /// All program output indices in `tx`.
    pub fn find_program_vouts(&self, tx: &Transaction, factory_asset_id: AssetId) -> Vec<u32> {
        tx.output
            .iter()
            .enumerate()
            .filter_map(|(vout, output)| {
                (self.classify_output(output, factory_asset_id)
                    == Some(IssuanceFactoryUtxoKind::Program))
                .then_some(vout as u32)
            })
            .collect()
    }

    /// All auth outputs in `tx` as `(vout, script_pubkey)`.
    pub fn find_auth_outputs(
        &self,
        tx: &Transaction,
        factory_asset_id: AssetId,
    ) -> Vec<(u32, Script)> {
        tx.output
            .iter()
            .enumerate()
            .filter_map(|(vout, output)| {
                (self.classify_output(output, factory_asset_id)
                    == Some(IssuanceFactoryUtxoKind::Auth))
                .then_some((vout as u32, output.script_pubkey.clone()))
            })
            .collect()
    }

    /// Unique program vout, if exactly one exists.
    pub fn find_unique_program_vout(
        &self,
        tx: &Transaction,
        factory_asset_id: AssetId,
    ) -> Option<u32> {
        let vouts = self.find_program_vouts(tx, factory_asset_id);

        match vouts.as_slice() {
            [vout] => Some(*vout),
            _ => None,
        }
    }

    /// Unique auth output, if exactly one exists.
    pub fn find_unique_auth_output(
        &self,
        tx: &Transaction,
        factory_asset_id: AssetId,
    ) -> Option<(u32, Script)> {
        let auths = self.find_auth_outputs(tx, factory_asset_id);

        match auths.as_slice() {
            [(vout, script)] => Some((*vout, script.clone())),
            _ => None,
        }
    }

    /// Scan creation layout: unique program + unique auth outputs.
    pub fn scan_creation(
        &self,
        tx: &Transaction,
        factory_asset_id: AssetId,
    ) -> Option<IssuanceFactoryCreationScan> {
        let program_vout = self.find_unique_program_vout(tx, factory_asset_id)?;
        let (auth_vout, auth_script_pubkey) = self.find_unique_auth_output(tx, factory_asset_id)?;

        Some(IssuanceFactoryCreationScan {
            program_vout,
            auth_vout,
            auth_script_pubkey,
        })
    }

    /// Scan assets-issuance layout: exactly one continuing program (+ any auth outs).
    ///
    /// Covenant allows a single IssuanceFactory program I/O per issuance tx.
    pub fn scan_assets_issuance(
        &self,
        tx: &Transaction,
        factory_asset_id: AssetId,
    ) -> Option<IssuanceFactoryAssetsIssuanceScan> {
        let program_vout = self.find_unique_program_vout(tx, factory_asset_id)?;

        Some(IssuanceFactoryAssetsIssuanceScan {
            program_vout,
            auth_vouts: self.find_auth_outputs(tx, factory_asset_id),
        })
    }

    /// Classify a transaction involving this factory asset.
    ///
    /// - `Creation` — valid creation metadata + unique program/auth creates
    /// - `AssetsIssuance` — exactly one continuing program output
    /// - `FactoryRemoval` — no continuing program output (program burned)
    ///
    /// Returns `None` when the tx does not look related to this factory
    /// (including an ambiguous multi-program layout).
    pub fn classify_tx(
        &self,
        tx: &Transaction,
        factory_asset_id: AssetId,
    ) -> Option<IssuanceFactoryTxKind> {
        if self.scan_creation(tx, factory_asset_id).is_some()
            && Self::has_creation_metadata(tx).is_some()
        {
            return Some(IssuanceFactoryTxKind::Creation);
        }

        let program_vouts = self.find_program_vouts(tx, factory_asset_id);
        match program_vouts.as_slice() {
            [_] => return Some(IssuanceFactoryTxKind::AssetsIssuance),
            [_, _, ..] => return None,
            [] => {}
        }

        // No program continuation: treat as removal when the factory asset still
        // appears (e.g. burns). Otherwise the tx is unrelated.
        let touches_factory_asset = tx
            .output
            .iter()
            .any(|output| output.asset.explicit() == Some(factory_asset_id));

        if touches_factory_asset {
            Some(IssuanceFactoryTxKind::FactoryRemoval)
        } else {
            None
        }
    }

    fn factory_from_creation_metadata(
        tx: &Transaction,
        network: SimplicityNetwork,
        txid: Txid,
    ) -> Result<Self, IssuanceFactoryError> {
        let op_return_bytes = Self::has_creation_metadata(tx)
            .ok_or(IssuanceFactoryError::NotAnIssuanceFactoryCreationTx(txid))?;

        let creation_metadata = Self::decode_metadata_op_return(op_return_bytes.to_vec())?;

        if creation_metadata.program_id != Self::get_program_id() {
            return Err(IssuanceFactoryError::NotAnIssuanceFactoryCreationTx(txid));
        }

        Ok(Self::new(IssuanceFactoryParameters {
            issuing_utxos_count: creation_metadata.issuing_utxos_count,
            reissuance_flags: creation_metadata.reissuance_flags,
            network,
        }))
    }

    fn has_creation_metadata(tx: &Transaction) -> Option<&[u8]> {
        if tx.output.len() <= Self::CREATION_METADATA_OUTPUT_INDEX {
            return None;
        }

        let output = &tx.output[Self::CREATION_METADATA_OUTPUT_INDEX];
        if !output.is_null_data() {
            return None;
        }

        op_return_payload(&output.script_pubkey)
    }

    fn find_unique_program_asset(&self, tx: &Transaction) -> Option<AssetId> {
        let matches: Vec<AssetId> = tx
            .output
            .iter()
            .filter_map(|output| {
                let asset_id = output.asset.explicit()?;
                let amount = output.value.explicit()?;
                (amount == 1 && output.script_pubkey == self.get_script_pubkey())
                    .then_some(asset_id)
            })
            .collect();

        match matches.as_slice() {
            [asset_id] => Some(*asset_id),
            _ => None,
        }
    }
}

fn is_factory_asset_utxo(output: &TxOut, factory_asset_id: AssetId) -> bool {
    let (Some(asset_id), Some(amount)) = (output.asset.explicit(), output.value.explicit()) else {
        return false;
    };

    asset_id == factory_asset_id && amount == 1 && !output.script_pubkey.is_op_return()
}

#[cfg(test)]
mod tests {
    use super::{IssuanceFactoryTxKind, IssuanceFactoryUtxoKind, is_factory_asset_utxo};
    use crate::programs::issuance_factory::{IssuanceFactory, IssuanceFactoryParameters};
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

    fn op_return_output(asset_id: AssetId) -> TxOut {
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

    fn test_factory() -> IssuanceFactory {
        IssuanceFactory::new(IssuanceFactoryParameters {
            issuing_utxos_count: 2,
            reissuance_flags: 0,
            network: SimplicityNetwork::default_regtest(),
        })
    }

    #[test]
    fn classify_output_distinguishes_program_and_auth() {
        let factory = test_factory();
        let factory_asset = asset(1);
        let program = factory.get_script_pubkey();
        let auth = script(&[0x52]);

        assert_eq!(
            factory.classify_output(&explicit_output(factory_asset, 1, program), factory_asset),
            Some(IssuanceFactoryUtxoKind::Program)
        );
        assert_eq!(
            factory.classify_output(&explicit_output(factory_asset, 1, auth), factory_asset),
            Some(IssuanceFactoryUtxoKind::Auth)
        );
        assert_eq!(
            factory.classify_output(
                &explicit_output(asset(2), 1, script(&[0x51])),
                factory_asset
            ),
            None
        );
    }

    #[test]
    fn scan_creation_requires_unique_program_and_auth() {
        let factory = test_factory();
        let factory_asset = asset(1);
        let program = factory.get_script_pubkey();
        let auth = script(&[0x52]);

        let tx = tx_with_outputs(vec![
            explicit_output(factory_asset, 1, auth.clone()),
            explicit_output(factory_asset, 1, program),
        ]);

        let scan = factory.scan_creation(&tx, factory_asset).expect("scan");
        assert_eq!(scan.program_vout, 1);
        assert_eq!(scan.auth_vout, 0);
        assert_eq!(scan.auth_script_pubkey, auth);
    }

    #[test]
    fn classify_tx_assets_issuance_vs_removal() {
        let factory = test_factory();
        let factory_asset = asset(1);
        let program = factory.get_script_pubkey();

        let issuance = tx_with_outputs(vec![
            explicit_output(factory_asset, 1, script(&[0x52])),
            explicit_output(factory_asset, 1, program),
        ]);
        assert_eq!(
            factory.classify_tx(&issuance, factory_asset),
            Some(IssuanceFactoryTxKind::AssetsIssuance)
        );

        let removal = tx_with_outputs(vec![
            op_return_output(factory_asset),
            op_return_output(factory_asset),
        ]);
        assert_eq!(
            factory.classify_tx(&removal, factory_asset),
            Some(IssuanceFactoryTxKind::FactoryRemoval)
        );

        let unrelated = tx_with_outputs(vec![explicit_output(asset(9), 1, script(&[0x51]))]);
        assert_eq!(factory.classify_tx(&unrelated, factory_asset), None);
    }

    #[test]
    fn scan_assets_issuance_requires_unique_program_vout() {
        let factory = test_factory();
        let factory_asset = asset(1);
        let program = factory.get_script_pubkey();

        let unique = tx_with_outputs(vec![
            explicit_output(factory_asset, 1, script(&[0x52])),
            explicit_output(factory_asset, 1, program.clone()),
        ]);
        assert_eq!(
            factory
                .scan_assets_issuance(&unique, factory_asset)
                .map(|scan| scan.program_vout),
            Some(1)
        );

        let ambiguous = tx_with_outputs(vec![
            explicit_output(factory_asset, 1, program.clone()),
            explicit_output(factory_asset, 1, program),
        ]);
        assert!(
            factory
                .scan_assets_issuance(&ambiguous, factory_asset)
                .is_none()
        );
        assert_eq!(factory.classify_tx(&ambiguous, factory_asset), None);
    }

    #[test]
    fn is_factory_asset_utxo_requires_explicit_amount_one() {
        let factory_asset = asset(1);
        assert!(is_factory_asset_utxo(
            &explicit_output(factory_asset, 1, script(&[0x51])),
            factory_asset
        ));
        assert!(!is_factory_asset_utxo(
            &explicit_output(factory_asset, 2, script(&[0x51])),
            factory_asset
        ));
    }
}
