use anyhow::{Context, Result};
use lending_contracts::script_auth::{
    SCRIPT_AUTH_SOURCE,
    build_arguments::ScriptAuthArguments,
    build_witness::{ScriptAuthWitnessParams, build_script_auth_witness},
};
use lwk_simplicity::scripts::{create_p2tr_address, load_program};
use lwk_simplicity::wallet_abi::schema::{
    AssetVariant, BlinderVariant, FinalizerSpec, InputSchema, InputUnblinding, InternalKeySource,
    LockVariant, OutputSchema, SimfArguments, SimfWitness, UTXOSource, serialize_arguments,
    serialize_witness,
};
use lwk_wollet::elements as el26;
use simplicityhl::elements as el25;

use crate::wallet_abi_common::{KnownUtxo, WalletAbiHarness, wallet_transfer_request};

#[derive(Clone, Debug)]
pub struct ScriptAuthLockState {
    pub arguments: ScriptAuthArguments,
    pub locked: KnownUtxo,
}

#[derive(Clone, Debug)]
pub struct ScriptAuthUnlockState {
    pub unlocked_asset: KnownUtxo,
    pub auth_output: KnownUtxo,
}

impl WalletAbiHarness {
    pub async fn create_script_auth(
        &self,
        lock_asset_id: el26::AssetId,
        lock_amount_sat: u64,
        arguments: ScriptAuthArguments,
    ) -> Result<ScriptAuthLockState> {
        let lock_asset_id_25 = lock_asset_id
            .to_string()
            .parse::<el25::AssetId>()
            .context("failed to convert asset id from elements 0.26 to 0.25")?;
        let script_auth_script_pubkey = create_p2tr_address(
            load_program(SCRIPT_AUTH_SOURCE, arguments.build_script_auth_arguments())?
                .commit()
                .cmr(),
            &InternalKeySource::Bip0341.get_x_only_pubkey(),
            lwk_common::Network::LocaltestLiquid.address_params(),
        )
        .script_pubkey();
        let tx = self
            .process_request(wallet_transfer_request(
                vec![InputSchema {
                    id: "locked-asset".into(),
                    utxo_source: UTXOSource::default(),
                    unblinding: InputUnblinding::Wallet,
                    sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                    issuance: None,
                    finalizer: FinalizerSpec::Wallet,
                }],
                vec![OutputSchema {
                    id: "script-auth".into(),
                    amount_sat: lock_amount_sat,
                    lock: LockVariant::Finalizer {
                        finalizer: Box::new(FinalizerSpec::Simf {
                            source_simf: SCRIPT_AUTH_SOURCE.to_string(),
                            internal_key: InternalKeySource::Bip0341,
                            arguments: serialize_arguments(&SimfArguments::new(
                                arguments.build_script_auth_arguments(),
                            ))?,
                            witness: serialize_witness(&SimfWitness {
                                resolved: build_script_auth_witness(&ScriptAuthWitnessParams {
                                    input_script_index: 0,
                                }),
                                runtime_arguments: vec![],
                            })?,
                        }),
                    },
                    asset: AssetVariant::AssetId {
                        asset_id: lock_asset_id,
                    },
                    blinder: BlinderVariant::Explicit,
                }],
            ))
            .await?;
        let locked = self.find_output(&tx, |tx_out| {
            tx_out.script_pubkey == script_auth_script_pubkey
                && tx_out.asset.explicit() == Some(lock_asset_id_25)
                && tx_out.value.explicit() == Some(lock_amount_sat)
        })?;

        Ok(ScriptAuthLockState { arguments, locked })
    }

    pub async fn unlock_script_auth(
        &self,
        state: &ScriptAuthLockState,
        auth_asset_id: el26::AssetId,
        auth_amount_sat: u64,
    ) -> Result<ScriptAuthUnlockState> {
        let auth_asset_id_25 = auth_asset_id
            .to_string()
            .parse::<el25::AssetId>()
            .context("failed to convert asset id from elements 0.26 to 0.25")?;
        let tx = self
            .process_request(wallet_transfer_request(
                vec![
                    InputSchema {
                        id: "script-auth".into(),
                        utxo_source: UTXOSource::Provided {
                            outpoint: state.locked.outpoint,
                        },
                        unblinding: InputUnblinding::Explicit,
                        sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                        issuance: None,
                        finalizer: FinalizerSpec::Simf {
                            source_simf: SCRIPT_AUTH_SOURCE.to_string(),
                            internal_key: InternalKeySource::Bip0341,
                            arguments: serialize_arguments(&SimfArguments::new(
                                state.arguments.build_script_auth_arguments(),
                            ))?,
                            witness: serialize_witness(&SimfWitness {
                                resolved: build_script_auth_witness(&ScriptAuthWitnessParams {
                                    input_script_index: 1,
                                }),
                                runtime_arguments: vec![],
                            })?,
                        },
                    },
                    InputSchema {
                        id: "auth-utxo".into(),
                        utxo_source: UTXOSource::default(),
                        unblinding: InputUnblinding::Wallet,
                        sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                        issuance: None,
                        finalizer: FinalizerSpec::Wallet,
                    },
                ],
                vec![
                    OutputSchema {
                        id: "unlocked-asset".into(),
                        amount_sat: state.locked.value()?,
                        lock: LockVariant::Script {
                            script: self.wallet_script_26().clone(),
                        },
                        asset: AssetVariant::AssetId {
                            asset_id: state.locked.asset_id_26()?,
                        },
                        blinder: BlinderVariant::Explicit,
                    },
                    OutputSchema {
                        id: "auth-output".into(),
                        amount_sat: auth_amount_sat,
                        lock: LockVariant::Script {
                            script: self.wallet_script_26().clone(),
                        },
                        asset: AssetVariant::AssetId {
                            asset_id: auth_asset_id,
                        },
                        blinder: BlinderVariant::Explicit,
                    },
                ],
            ))
            .await?;
        let unlocked_asset = self.find_output(&tx, |tx_out| {
            tx_out.script_pubkey == *self.wallet_script_25()
                && tx_out.asset.explicit() == Some(state.locked.asset_id_25().expect("asset"))
                && tx_out.value.explicit() == Some(state.locked.value().expect("value"))
        })?;
        let auth_output = self.find_output(&tx, |tx_out| {
            tx_out.script_pubkey == *self.wallet_script_25()
                && tx_out.asset.explicit() == Some(auth_asset_id_25)
                && tx_out.value.explicit() == Some(auth_amount_sat)
        })?;

        Ok(ScriptAuthUnlockState {
            unlocked_asset,
            auth_output,
        })
    }
}
