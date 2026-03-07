use anyhow::{Context, Result, bail};
use lending_contracts::asset_auth::{
    ASSET_AUTH_SOURCE,
    build_arguments::AssetAuthArguments,
    build_witness::{AssetAuthWitnessParams, build_asset_auth_witness},
};
use lwk_simplicity::wallet_abi::schema::{
    AssetVariant, BlinderVariant, FinalizerSpec, InputSchema, InputUnblinding, InternalKeySource,
    LockVariant, OutputSchema, SimfArguments, SimfWitness, UTXOSource, serialize_arguments,
    serialize_witness,
};
use lwk_wollet::elements as el26;
use lwk_wollet::elements::{AssetId, OutPoint, Script};
use simplicityhl::elements as el25;

use crate::wallet_abi_common::{WalletAbiHarness, wallet_transfer_request};

#[derive(Clone, Debug)]
pub struct AssetAuthState {
    pub arguments: AssetAuthArguments,
    pub asset_id: AssetId,
    pub amount_sat: u64,
    pub last_outpoint: OutPoint,
}

impl WalletAbiHarness {
    pub async fn create_asset_auth(
        &self,
        asset_id: &AssetId,
        amount_sat: u64,
        arguments: AssetAuthArguments,
    ) -> Result<AssetAuthState> {
        let asset_id_25 = asset_id
            .to_string()
            .parse::<el25::AssetId>()
            .context("failed to convert asset id from elements 0.26 to 0.25")?;
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
                    id: "asset-auth".into(),
                    amount_sat,
                    lock: LockVariant::Finalizer {
                        finalizer: Box::new(FinalizerSpec::Simf {
                            source_simf: ASSET_AUTH_SOURCE.to_string(),
                            internal_key: InternalKeySource::Bip0341,
                            arguments: serialize_arguments(&SimfArguments::new(
                                arguments.build_asset_auth_arguments(),
                            ))?,
                            witness: serialize_witness(&SimfWitness {
                                resolved: build_asset_auth_witness(&AssetAuthWitnessParams {
                                    input_asset_index: 0,
                                    output_asset_index: 0,
                                }),
                                runtime_arguments: vec![],
                            })?,
                        }),
                    },
                    asset: AssetVariant::AssetId {
                        asset_id: *asset_id,
                    },
                    blinder: BlinderVariant::Explicit,
                }],
            ))
            .await?;
        let auth_output = self.find_output(&tx, |tx_out| {
            tx_out.asset.explicit() == Some(asset_id_25)
                && tx_out.value.explicit() == Some(amount_sat)
        })?;
        if auth_output.asset_id_25()? != asset_id_25 {
            bail!("asset-auth output asset id does not match requested asset id");
        }

        Ok(AssetAuthState {
            arguments,
            asset_id: auth_output.asset_id_26()?,
            amount_sat: auth_output.value()?,
            last_outpoint: auth_output.outpoint,
        })
    }

    pub async fn unlock_asset_auth(&self, state: &mut AssetAuthState) -> Result<()> {
        let mut outputs = vec![];
        let wallet_script = self.wallet_script_25().clone();
        let burn_script = Script::new_op_return(b"burn");
        let burn_script_bytes = burn_script.as_bytes().to_vec();
        let asset_id_25 = state
            .asset_id
            .to_string()
            .parse::<el25::AssetId>()
            .context("failed to convert asset id from elements 0.26 to 0.25")?;
        outputs.push(if state.arguments.with_asset_burn {
            OutputSchema {
                id: "auth-output".into(),
                amount_sat: state.amount_sat,
                lock: LockVariant::Script {
                    script: burn_script,
                },
                asset: AssetVariant::AssetId {
                    asset_id: state.asset_id,
                },
                blinder: BlinderVariant::Explicit,
            }
        } else {
            OutputSchema {
                id: "auth-output".into(),
                amount_sat: state.amount_sat,
                lock: LockVariant::Script {
                    script: self.wallet_script_26().clone(),
                },
                asset: AssetVariant::AssetId {
                    asset_id: state.asset_id,
                },
                blinder: BlinderVariant::Explicit,
            }
        });

        let tx = self
            .process_request(wallet_transfer_request(
                vec![InputSchema {
                    id: "asset-auth".into(),
                    utxo_source: UTXOSource::Provided {
                        outpoint: state.last_outpoint,
                    },
                    unblinding: InputUnblinding::Explicit,
                    sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                    issuance: None,
                    finalizer: FinalizerSpec::Simf {
                        source_simf: ASSET_AUTH_SOURCE.to_string(),
                        internal_key: InternalKeySource::Bip0341,
                        arguments: serialize_arguments(&SimfArguments::new(
                            state.arguments.build_asset_auth_arguments(),
                        ))?,
                        witness: serialize_witness(&SimfWitness {
                            resolved: build_asset_auth_witness(&AssetAuthWitnessParams {
                                input_asset_index: 0,
                                output_asset_index: 0,
                            }),
                            runtime_arguments: vec![],
                        })?,
                    },
                }],
                outputs,
            ))
            .await?;
        let auth_output = if state.arguments.with_asset_burn {
            self.find_output(&tx, |tx_out| {
                tx_out.script_pubkey.as_bytes() == burn_script_bytes.as_slice()
                    && tx_out.asset.explicit() == Some(asset_id_25)
                    && tx_out.value.explicit() == Some(state.amount_sat)
            })?
        } else {
            self.find_output(&tx, |tx_out| {
                tx_out.script_pubkey == wallet_script
                    && tx_out.asset.explicit() == Some(asset_id_25)
                    && tx_out.value.explicit() == Some(state.amount_sat)
            })?
        };

        state.last_outpoint = auth_output.outpoint;

        Ok(())
    }
}
