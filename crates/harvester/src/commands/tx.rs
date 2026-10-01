use std::collections::HashMap;
use std::collections::hash_map::Entry;
use std::path::Path;
use std::str::FromStr;

use lending_contracts::programs::asset_auth_vault::{AssetAuthVault, AssetAuthVaultParameters};
use lending_contracts::programs::fee_collector::FeeCollector;
use lending_contracts::programs::program::SimplexProgram;
use lending_indexer::api::ProtocolFeeVaultDto;
use simplex::provider::SimplicityNetwork;
use simplex::signer::Signer;
use simplex::simplicityhl::elements::{Address, AssetId, Script, Sequence, Transaction};
use simplex::transaction::{
    FinalTransaction, PartialInput, PartialOutput, RequiredSignature, UTXO,
};

use crate::AppContext;
use crate::batch::{self, FeeBatch, Selection, Step};
use crate::error::HarvesterError;
use crate::state::State;

use super::{
    collector_utxo, harvest_signer, open_fee_collector, parse_asset_id, parse_outpoint,
    parse_vault_asset, parse_vault_u64, signer_error,
};

pub(super) const BOOTSTRAP_AMOUNT: u64 = 1_000;

pub(super) fn prepare_harvest(
    ctx: &AppContext,
    path: &Path,
    state: &State,
    vaults: &[ProtocolFeeVaultDto],
    amounts: &[u64],
) -> Result<Option<(FeeBatch<Transaction>, State)>, HarvesterError> {
    let signer = harvest_signer(ctx)?;
    let collector = open_fee_collector(ctx)?;
    let (collector_utxo, state) = collector_utxo(path, &signer, &collector, state)?;
    let mut transaction = new_transaction();
    let mut keepers: HashMap<AssetId, Vec<UTXO>> = HashMap::new();
    let mut attached_keepers: HashMap<AssetId, (u32, u32)> = HashMap::new();
    let network = ctx.settings.esplora.simplicity_network();
    let principal_asset = parse_asset_id("principal_asset", &ctx.settings.principal_asset)?;
    let policy_asset = network.policy_asset();
    let change_script = signer.get_address().script_pubkey();

    let selection = if principal_asset == policy_asset {
        Selection::Profitable
    } else {
        Selection::All
    };

    let batch = batch::select(
        amounts,
        ctx.settings.harvest.max_vaults_per_tx as usize,
        selection,
        |index, total_amount| {
            let vault = &vaults[index];
            let program = match finalized_vault(vault, principal_asset, network) {
                Ok(program) => program,
                Err(err) => return vault_fault(&vault.offer_id, err),
            };
            let keeper_asset = program.get_parameters().keeper_asset_id;
            let wallet_has_utxo = if attached_keepers.contains_key(&keeper_asset) {
                false
            } else {
                match keeper_available(&signer, &mut keepers, keeper_asset) {
                    Ok(available) => available,
                    Err(err) => return vault_fault(&vault.offer_id, err),
                }
            };
            let keeper_choice = choose_keeper(&attached_keepers, wallet_has_utxo, keeper_asset);
            if keeper_choice == KeeperChoice::Missing {
                tracing::info!(
                    offer_id = %vault.offer_id,
                    asset = %vault.protocol_fee_keeper_asset,
                    "skipping vault: no keeper UTXO"
                );
                return Ok(Step::Skip);
            }

            if collector_utxo
                .explicit_amount()
                .checked_add(total_amount)
                .is_none()
            {
                return vault_fault(&vault.offer_id, HarvesterError::AmountOverflow);
            }

            let indexed_amount = amounts[index];
            let outpoint = format!("{}:{}", vault.txid, vault.vout);
            let vault_outpoint = match parse_outpoint(&vault.txid, vault.vout) {
                Ok(outpoint) => outpoint,
                Err(err) => return vault_fault(&vault.offer_id, err),
            };
            let vault_utxos = match signer.get_provider() {
                Ok(provider) => {
                    match provider.fetch_scripthash_utxos(&program.get_script_pubkey()) {
                        Ok(utxos) => utxos,
                        Err(err) => return vault_fault(&vault.offer_id, err.into()),
                    }
                }
                Err(err) => return vault_fault(&vault.offer_id, signer_error("harvest", err)),
            };
            let Some(vault_utxo) = vault_utxos
                .into_iter()
                .find(|utxo| utxo.outpoint == vault_outpoint)
            else {
                tracing::warn!(
                    offer_id = %vault.offer_id,
                    %outpoint,
                    "skipping vault: protocol-fee UTXO was not found"
                );
                return Ok(Step::Skip);
            };

            let on_chain = vault_utxo.explicit_amount();
            if on_chain != indexed_amount {
                tracing::warn!(
                    offer_id = %vault.offer_id,
                    %outpoint,
                    on_chain,
                    indexed = indexed_amount,
                    "skipping vault: on-chain amount does not match the indexer"
                );
                return Ok(Step::Skip);
            }

            let (input_keeper_index, output_keeper_index) = match keeper_choice {
                KeeperChoice::Reuse {
                    input_index,
                    output_index,
                } => (input_index, output_index),
                KeeperChoice::Attach => {
                    let keeper_utxo = match next_keeper(&signer, &mut keepers, keeper_asset) {
                        Ok(utxo) => utxo.expect("explicit keeper UTXO is cached"),
                        Err(err) => return vault_fault(&vault.offer_id, err),
                    };
                    let keeper_amount = keeper_utxo.explicit_amount();
                    let keeper_asset_id = keeper_utxo.explicit_asset();
                    let input_keeper_index = transaction.n_inputs() as u32;
                    let output_keeper_index = transaction.n_outputs() as u32;
                    transaction.add_input(
                        PartialInput::new(keeper_utxo),
                        RequiredSignature::NativeEcdsa,
                    );
                    transaction.add_output(PartialOutput::new(
                        change_script.clone(),
                        keeper_amount,
                        keeper_asset_id,
                    ));
                    attached_keepers
                        .insert(keeper_asset, (input_keeper_index, output_keeper_index));
                    (input_keeper_index, output_keeper_index)
                }
                KeeperChoice::Missing => unreachable!("missing keeper already skipped"),
            };
            program.attach_withdrawing_all(
                &mut transaction,
                vault_utxo,
                input_keeper_index,
                output_keeper_index,
            );

            let mut prefix = transaction.clone();
            collector.attach_deposit(&mut prefix, collector_utxo.clone(), total_amount);
            match signer.finalize(&prefix) {
                Ok((transaction, _)) => {
                    let tx_fee = transaction.fee_in(policy_asset);
                    Ok(Step::Ready {
                        transaction,
                        tx_fee,
                    })
                }
                Err(err) => vault_fault(&vault.offer_id, signer_error("harvest", err)),
            }
        },
    )?;
    Ok(batch.map(|batch| (batch, state)))
}

fn vault_fault<T>(
    offer_id: &str,
    err: HarvesterError,
) -> Result<Step<T, HarvesterError>, HarvesterError> {
    match &err {
        HarvesterError::InvalidVaultField { .. } | HarvesterError::InvalidTxid { .. } => {
            tracing::warn!(offer_id, error = %err, "skipping vault");
            Ok(Step::Skip)
        }
        _ => {
            tracing::warn!(
                offer_id,
                error = %err,
                "stopping the harvest batch at this vault"
            );
            Ok(Step::Stop(err))
        }
    }
}

fn finalized_vault(
    vault: &ProtocolFeeVaultDto,
    principal_asset: AssetId,
    network: SimplicityNetwork,
) -> Result<AssetAuthVault, HarvesterError> {
    Ok(AssetAuthVault::new_finalized(AssetAuthVaultParameters {
        vault_asset_id: principal_asset,
        keeper_asset_id: parse_vault_asset(
            &vault.offer_id,
            "protocol_fee_keeper_asset",
            &vault.protocol_fee_keeper_asset,
        )?,
        supplier_asset_id: parse_vault_asset(
            &vault.offer_id,
            "borrower_nft_asset",
            &vault.borrower_nft_asset,
        )?,
        supply_goal: parse_vault_u64(&vault.offer_id, "supply_goal", &vault.supply_goal)?,
        with_keeper_asset_burn: false,
        with_supplier_asset_burn: false,
        network,
    }))
}

fn keeper_available(
    signer: &Signer,
    keepers: &mut HashMap<AssetId, Vec<UTXO>>,
    asset: AssetId,
) -> Result<bool, HarvesterError> {
    cache_explicit_keepers(signer, keepers, asset)?;
    Ok(keepers.get(&asset).is_some_and(|utxos| !utxos.is_empty()))
}

fn next_keeper(
    signer: &Signer,
    keepers: &mut HashMap<AssetId, Vec<UTXO>>,
    asset: AssetId,
) -> Result<Option<UTXO>, HarvesterError> {
    cache_explicit_keepers(signer, keepers, asset)?;
    Ok(keepers.get_mut(&asset).and_then(Vec::pop))
}

fn cache_explicit_keepers(
    signer: &Signer,
    keepers: &mut HashMap<AssetId, Vec<UTXO>>,
    asset: AssetId,
) -> Result<(), HarvesterError> {
    if let Entry::Vacant(entry) = keepers.entry(asset) {
        entry.insert(explicit_keeper_utxos(signer.get_utxos_asset(asset)?));
    }
    Ok(())
}

fn explicit_keeper_utxos(mut utxos: Vec<UTXO>) -> Vec<UTXO> {
    utxos.retain(|utxo| utxo.txout.asset.is_explicit() && utxo.txout.value.is_explicit());
    utxos
}

fn choose_keeper(
    attached: &HashMap<AssetId, (u32, u32)>,
    wallet_has_utxo: bool,
    asset: AssetId,
) -> KeeperChoice {
    if let Some(&(input_index, output_index)) = attached.get(&asset) {
        KeeperChoice::Reuse {
            input_index,
            output_index,
        }
    } else if wallet_has_utxo {
        KeeperChoice::Attach
    } else {
        KeeperChoice::Missing
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum KeeperChoice {
    Reuse { input_index: u32, output_index: u32 },
    Attach,
    Missing,
}

pub(super) fn finalize_withdrawal(
    signer: &Signer,
    collector: &FeeCollector,
    collector_utxo: UTXO,
    destination: Script,
) -> Result<(Transaction, u64), HarvesterError> {
    let pool_amount = collector_utxo.explicit_amount();
    let asset = collector_utxo.explicit_asset();
    let mut transaction = new_transaction();
    collector.attach_withdrawal(&mut transaction, collector_utxo);
    transaction.add_output(PartialOutput::new(destination, pool_amount, asset));
    let (transaction, _fee) = signer
        .finalize(&transaction)
        .map_err(|err| signer_error("withdraw", err))?;
    Ok((transaction, pool_amount))
}

pub(super) fn finalize_bootstrap(
    signer: &Signer,
    fee_collector: &FeeCollector,
    principal_asset: AssetId,
    policy_asset: AssetId,
    principal_name: &str,
    funding_utxos: &[UTXO],
) -> Result<(Transaction, u64), HarvesterError> {
    let mut transaction = new_transaction();
    let mut change_output = None;
    let pool_amount = if principal_asset == policy_asset {
        BOOTSTRAP_AMOUNT
    } else {
        let selected = select_bootstrap_utxos(funding_utxos, principal_name)?;
        let total = selected
            .iter()
            .try_fold(0u64, |acc, utxo| acc.checked_add(utxo.amount()))
            .ok_or(HarvesterError::AmountOverflow)?;
        let confidential = selected.iter().any(is_confidential);
        let (pool_amount, change) = bootstrap_split(total, confidential);
        for utxo in selected {
            transaction.add_input(PartialInput::new(utxo), RequiredSignature::NativeEcdsa);
        }
        if change > 0 {
            let mut output = PartialOutput::new(
                signer.get_address().script_pubkey(),
                change,
                principal_asset,
            );
            if confidential {
                output = output.with_blinding_key(signer.get_blinding_public_key());
            }
            change_output = Some(output);
        }
        pool_amount
    };

    fee_collector.attach_creation(&mut transaction, principal_asset, pool_amount);
    if let Some(output) = change_output {
        transaction.add_output(output);
    }

    let (transaction, _fee) = signer
        .finalize(&transaction)
        .map_err(|err| signer_error("harvest", err))?;
    Ok((transaction, pool_amount))
}

fn select_bootstrap_utxos(
    funding_utxos: &[UTXO],
    principal_asset: &str,
) -> Result<Vec<UTXO>, HarvesterError> {
    let mut utxos = funding_utxos.to_vec();
    utxos.sort_by_key(UTXO::amount);

    if let Some(index) = utxos
        .iter()
        .position(|utxo| utxo.amount() >= BOOTSTRAP_AMOUNT)
    {
        return Ok(vec![utxos.swap_remove(index)]);
    }

    let mut selected = Vec::new();
    let mut total = 0u64;
    for utxo in utxos {
        total = total
            .checked_add(utxo.amount())
            .ok_or(HarvesterError::AmountOverflow)?;
        selected.push(utxo);
        if total >= BOOTSTRAP_AMOUNT {
            return Ok(selected);
        }
    }

    Err(HarvesterError::NoBootstrapFunds {
        principal_asset: principal_asset.to_owned(),
    })
}

fn bootstrap_split(total: u64, confidential: bool) -> (u64, u64) {
    let change = total.saturating_sub(BOOTSTRAP_AMOUNT);
    if change == 0 || confidential || change >= BOOTSTRAP_AMOUNT {
        (BOOTSTRAP_AMOUNT, change)
    } else {
        (total, 0)
    }
}

fn is_confidential(utxo: &UTXO) -> bool {
    !utxo.txout.asset.is_explicit() || !utxo.txout.value.is_explicit()
}

fn new_transaction() -> FinalTransaction {
    let mut transaction = FinalTransaction::new();
    transaction.set_sequence(Sequence::ENABLE_RBF_NO_LOCKTIME);
    transaction
}

pub(super) fn destination_script(
    ctx: &AppContext,
    to: Option<&str>,
) -> Result<Script, HarvesterError> {
    let address = to
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .or_else(|| {
            let configured = ctx.settings.withdraw.destination_address.trim();
            (!configured.is_empty()).then(|| configured.to_owned())
        })
        .ok_or(HarvesterError::MissingDestination)?;

    Address::from_str(&address)
        .map(|address| address.script_pubkey())
        .map_err(|_| HarvesterError::InvalidAddress { address })
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use simplex::simplicityhl::elements::confidential::{
        self, AssetBlindingFactor, ValueBlindingFactor,
    };
    use simplex::simplicityhl::elements::secp256k1_zkp::Secp256k1;
    use simplex::simplicityhl::elements::{AssetId, OutPoint, TxOut, TxOutSecrets, Txid};
    use simplex::transaction::UTXO;

    use crate::batch::Step;
    use crate::error::HarvesterError;

    #[test]
    fn a_bad_vault_field_is_skipped_and_a_provider_failure_stops_the_batch() {
        let skipped = super::vault_fault::<()>(
            "1",
            HarvesterError::InvalidVaultField {
                offer_id: "1".to_owned(),
                field: "supply_goal",
                value: "nope".to_owned(),
            },
        )
        .unwrap();
        assert!(matches!(skipped, Step::Skip));

        let bad_txid = super::vault_fault::<()>(
            "1",
            HarvesterError::InvalidTxid {
                txid: "zz".to_owned(),
            },
        )
        .unwrap();
        assert!(matches!(bad_txid, Step::Skip));

        let stopped = super::vault_fault::<()>("1", HarvesterError::AmountOverflow).unwrap();
        assert!(matches!(
            stopped,
            Step::Stop(HarvesterError::AmountOverflow)
        ));
    }

    #[test]
    fn bootstrap_spends_the_smallest_utxo_that_covers_the_seed() {
        let asset = asset_id("11");
        let selected = super::select_bootstrap_utxos(
            &[
                explicit_keeper(asset, 500, 0),
                explicit_keeper(asset, super::BOOTSTRAP_AMOUNT, 1),
                explicit_keeper(asset, 50_000, 2),
            ],
            "11",
        )
        .unwrap();

        assert_eq!(selected.len(), 1);
        assert_eq!(selected[0].amount(), super::BOOTSTRAP_AMOUNT);
    }

    #[test]
    fn bootstrap_combines_utxos_until_the_seed_is_covered() {
        let asset = asset_id("11");
        let selected = super::select_bootstrap_utxos(
            &[
                explicit_keeper(asset, 400, 0),
                explicit_keeper(asset, 400, 1),
                explicit_keeper(asset, 400, 2),
            ],
            "11",
        )
        .unwrap();

        let total: u64 = selected.iter().map(UTXO::amount).sum();
        assert_eq!(selected.len(), 3);
        assert_eq!(total, 1_200);
    }

    #[test]
    fn bootstrap_rejects_a_wallet_below_the_seed() {
        let asset = asset_id("11");
        let error =
            super::select_bootstrap_utxos(&[explicit_keeper(asset, 400, 0)], "asset").unwrap_err();

        assert!(matches!(error, HarvesterError::NoBootstrapFunds { .. }));
    }

    #[test]
    fn explicit_change_below_the_seed_stays_in_the_collector() {
        assert_eq!(super::bootstrap_split(1_500, false), (1_500, 0));
        assert_eq!(
            super::bootstrap_split(5_000, false),
            (super::BOOTSTRAP_AMOUNT, 4_000)
        );
        assert_eq!(
            super::bootstrap_split(1_005, true),
            (super::BOOTSTRAP_AMOUNT, 5)
        );
    }

    #[test]
    fn trailing_confidential_keeper_is_not_spent_before_an_explicit_one() {
        let asset = asset_id("11");
        let first = explicit_keeper(asset, 5, 1);
        let second = explicit_keeper(asset, 7, 2);
        let confidential = confidential_keeper(asset, 9, 3, false, false);
        assert_eq!(confidential.amount(), 9);
        assert_eq!(confidential.asset(), asset);

        let mut keepers = super::explicit_keeper_utxos(vec![first, second, confidential]);

        let chosen = keepers.pop().expect("explicit keeper");
        assert_eq!(chosen.explicit_amount(), 7);
        assert_eq!(chosen.explicit_asset(), asset);
        assert_eq!(
            keepers
                .pop()
                .expect("earlier explicit keeper")
                .explicit_amount(),
            5
        );
        assert!(keepers.pop().is_none());
    }

    #[test]
    fn keeper_input_must_be_explicit_in_both_asset_and_amount() {
        let asset = asset_id("11");
        let explicit = explicit_keeper(asset, 5, 1);
        let blinded_amount = confidential_keeper(asset, 9, 2, true, false);
        let blinded_asset = confidential_keeper(asset, 8, 3, false, true);

        let mut keepers =
            super::explicit_keeper_utxos(vec![explicit, blinded_amount, blinded_asset]);

        assert_eq!(keepers.len(), 1);
        let chosen = keepers.pop().expect("explicit keeper");
        assert_eq!(chosen.explicit_amount(), 5);
        assert_eq!(chosen.explicit_asset(), asset);
    }

    #[test]
    fn only_a_confidential_keeper_counts_as_missing() {
        let asset = asset_id("11");
        let confidential = confidential_keeper(asset, 9, 3, false, false);
        let available = !super::explicit_keeper_utxos(vec![confidential]).is_empty();

        assert!(!available);
        assert_eq!(
            super::choose_keeper(&std::collections::HashMap::new(), available, asset),
            super::KeeperChoice::Missing
        );
    }

    #[test]
    fn one_keeper_authorizes_every_later_vault() {
        let asset = asset_id("11");
        let other = asset_id("22");
        let mut attached = std::collections::HashMap::new();

        assert_eq!(
            super::choose_keeper(&attached, true, asset),
            super::KeeperChoice::Attach
        );
        attached.insert(asset, (0, 1));
        assert_eq!(
            super::choose_keeper(&attached, false, asset),
            super::KeeperChoice::Reuse {
                input_index: 0,
                output_index: 1,
            }
        );
        assert_eq!(
            super::choose_keeper(&attached, false, other),
            super::KeeperChoice::Missing
        );
        assert_eq!(
            super::choose_keeper(&attached, true, other),
            super::KeeperChoice::Attach
        );
    }

    fn asset_id(byte: &str) -> simplex::simplicityhl::elements::AssetId {
        simplex::simplicityhl::elements::AssetId::from_str(&byte.repeat(32)).unwrap()
    }

    fn outpoint(txid: &str, vout: u32) -> OutPoint {
        OutPoint {
            txid: Txid::from_str(txid).unwrap(),
            vout,
        }
    }

    fn explicit_keeper(asset: AssetId, amount: u64, vout: u32) -> UTXO {
        UTXO {
            outpoint: outpoint(&"aa".repeat(32), vout),
            txout: TxOut::new_fee(amount, asset),
            secrets: None,
        }
    }

    fn confidential_keeper(
        asset: AssetId,
        amount: u64,
        vout: u32,
        explicit_asset: bool,
        explicit_value: bool,
    ) -> UTXO {
        let secp = Secp256k1::new();
        let asset_blinding = AssetBlindingFactor::from_slice(&[1; 32]).expect("asset blinding");
        let value_blinding = ValueBlindingFactor::from_slice(&[2; 32]).expect("value blinding");
        let blinded_asset = confidential::Asset::new_confidential(&secp, asset, asset_blinding);
        let blinded_value = confidential::Value::new_confidential_from_assetid(
            &secp,
            amount,
            asset,
            value_blinding,
            asset_blinding,
        );

        UTXO {
            outpoint: outpoint(&"bb".repeat(32), vout),
            txout: TxOut {
                asset: if explicit_asset {
                    confidential::Asset::Explicit(asset)
                } else {
                    blinded_asset
                },
                value: if explicit_value {
                    confidential::Value::Explicit(amount)
                } else {
                    blinded_value
                },
                ..TxOut::default()
            },
            secrets: Some(TxOutSecrets::new(
                asset,
                asset_blinding,
                amount,
                value_blinding,
            )),
        }
    }
}
