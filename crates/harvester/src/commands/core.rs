use std::path::Path;
use std::str::FromStr;

use lending_contracts::programs::fee_collector::{FeeCollector, FeeCollectorParameters};
use lending_contracts::programs::program::SimplexProgram;
use simplex::provider::EsploraProvider;
use simplex::signer::{Signer, SignerError};
use simplex::simplicityhl::elements::secp256k1_zkp::XOnlyPublicKey;
use simplex::simplicityhl::elements::{AssetId, OutPoint, Txid};
use simplex::transaction::UTXO;

use super::pending::{publish, settle_pending};
use super::tx::{destination_script, finalize_withdrawal, prepare_harvest};
use crate::AppContext;
use crate::error::HarvesterError;
use crate::state::{State, StateLock};
use crate::vaults;

pub async fn run(ctx: &AppContext) -> Result<(), HarvesterError> {
    let interval = ctx.harvest_interval();
    tracing::info!(interval_secs = interval.as_secs(), "starting harvest loop");

    loop {
        if let Err(error) = harvest(ctx).await {
            tracing::error!(error = %error, "harvest failed");
        }
        tokio::time::sleep(interval).await;
    }
}

pub async fn harvest(ctx: &AppContext) -> Result<(), HarvesterError> {
    let path = crate::state_path();
    let _lock = StateLock::lock(&path)?;
    let collector = settle_pending(ctx, &path, load_collector(&path)?)?;
    let vaults = vaults::fetch_claimable_vaults(ctx).await?;

    tracing::info!(
        principal_asset = %ctx.settings.principal_asset,
        total_count = vaults.total_count,
        total_amount = %vaults.total_amount,
        fetched = vaults.items.len(),
        "fetched protocol-fee vaults"
    );

    let amounts = vaults
        .items
        .iter()
        .map(vaults::parse_amount)
        .collect::<Result<Vec<_>, _>>()?;
    let Some(batch) = prepare_harvest(ctx, &path, collector.as_ref(), &vaults.items, &amounts)?
    else {
        tracing::info!("no protocol-fee batch");
        return Ok(());
    };

    tracing::info!(
        selected = batch.count,
        total_amount = batch.total_amount,
        tx_fee = batch.tx_fee,
        "selected protocol-fee batch"
    );
    publish(ctx, &path, collector.as_ref(), &batch.transaction, true)
}

pub async fn withdraw(ctx: &AppContext, to: Option<&str>) -> Result<(), HarvesterError> {
    let destination = destination_script(ctx, to)?;
    let path = crate::state_path();
    let _lock = StateLock::lock(&path)?;
    let Some(state) = settle_pending(ctx, &path, load_collector(&path)?)? else {
        return Err(HarvesterError::NoCollector { path });
    };

    let signer = withdraw_signer(ctx)?;
    let collector = open_fee_collector(ctx)?;
    let collector_utxo = collector_utxo(&path, &signer, &collector, &state)?;
    let (transaction, amount) =
        finalize_withdrawal(&signer, &collector, collector_utxo, destination)?;
    tracing::info!(txid = %transaction.txid(), amount, "submitting withdrawal");
    publish(ctx, &path, Some(&state), &transaction, false)
}

pub(super) fn collector_utxo(
    path: &Path,
    signer: &Signer,
    collector: &FeeCollector,
    state: &State,
) -> Result<UTXO, HarvesterError> {
    let saved = state
        .outpoint
        .as_ref()
        .ok_or_else(|| HarvesterError::NoCollector {
            path: path.to_path_buf(),
        })?;
    signer
        .get_provider()?
        .fetch_scripthash_utxos(&collector.get_script_pubkey())?
        .into_iter()
        .find(|utxo| utxo.outpoint == *saved)
        .ok_or_else(|| HarvesterError::MissingCollectorUtxo {
            outpoint: saved.to_string(),
        })
}

pub(super) fn esplora_provider(ctx: &AppContext) -> EsploraProvider {
    EsploraProvider::new(
        ctx.settings.esplora.base_url.clone(),
        ctx.settings.esplora.simplicity_network(),
    )
}

fn signer(ctx: &AppContext, mnemonic: &str, field: &'static str) -> Result<Signer, HarvesterError> {
    let mnemonic = validate_mnemonic(field, mnemonic)?;
    Ok(Signer::new(&mnemonic, Box::new(esplora_provider(ctx))))
}

fn validate_mnemonic(field: &'static str, mnemonic: &str) -> Result<String, HarvesterError> {
    let mnemonic = mnemonic.trim();
    if bip39::Mnemonic::parse(mnemonic).is_err() {
        return Err(HarvesterError::InvalidMnemonic { field });
    }
    Ok(mnemonic.to_owned())
}

pub(super) fn signer_error(wallet: &'static str, err: SignerError) -> HarvesterError {
    match err {
        SignerError::NotEnoughFunds(required_fee) => HarvesterError::InsufficientFeeFunds {
            wallet,
            required_fee,
        },
        err => err.into(),
    }
}

pub(super) fn harvest_signer(ctx: &AppContext) -> Result<Signer, HarvesterError> {
    signer(ctx, &ctx.settings.harvest.mnemonic, "harvest.mnemonic")
}

fn withdraw_signer(ctx: &AppContext) -> Result<Signer, HarvesterError> {
    signer(ctx, &ctx.settings.withdraw.mnemonic, "withdraw.mnemonic")
}

pub(super) fn open_fee_collector(ctx: &AppContext) -> Result<FeeCollector, HarvesterError> {
    Ok(FeeCollector::new(FeeCollectorParameters {
        withdrawal_pubkey: parse_withdrawal_pubkey(&ctx.settings.collector.withdraw_pubkey)?,
        network: ctx.settings.esplora.simplicity_network(),
    }))
}

pub(super) fn parse_outpoint(txid: &str, vout: u32) -> Result<OutPoint, HarvesterError> {
    let txid = Txid::from_str(txid).map_err(|_| HarvesterError::InvalidTxid {
        txid: txid.to_owned(),
    })?;
    Ok(OutPoint { txid, vout })
}

pub(super) fn parse_vault_asset(
    offer_id: &str,
    field: &'static str,
    value: &str,
) -> Result<AssetId, HarvesterError> {
    AssetId::from_str(value).map_err(|_| HarvesterError::InvalidVaultField {
        offer_id: offer_id.to_owned(),
        field,
        value: value.to_owned(),
    })
}

pub(super) fn parse_vault_u64(
    offer_id: &str,
    field: &'static str,
    value: &str,
) -> Result<u64, HarvesterError> {
    value
        .parse()
        .map_err(|_| HarvesterError::InvalidVaultField {
            offer_id: offer_id.to_owned(),
            field,
            value: value.to_owned(),
        })
}

pub(super) fn parse_asset_id(field: &'static str, value: &str) -> Result<AssetId, HarvesterError> {
    AssetId::from_str(value).map_err(|_| HarvesterError::InvalidSetting {
        field,
        value: value.to_owned(),
    })
}

fn parse_withdrawal_pubkey(value: &str) -> Result<XOnlyPublicKey, HarvesterError> {
    XOnlyPublicKey::from_str(value).map_err(|_| HarvesterError::InvalidSetting {
        field: "collector.withdraw_pubkey",
        value: value.to_owned(),
    })
}

fn load_collector(path: &Path) -> Result<Option<State>, HarvesterError> {
    State::load(path)
}

#[cfg(test)]
mod tests {
    use simplex::signer::SignerError;

    use super::signer_error;
    use crate::error::HarvesterError;

    #[test]
    fn not_enough_funds_reports_the_required_fee() {
        let error = signer_error("harvest", SignerError::NotEnoughFunds(1_500));

        assert!(matches!(
            error,
            HarvesterError::InsufficientFeeFunds {
                wallet: "harvest",
                required_fee: 1_500,
            }
        ));
    }

    #[test]
    fn empty_mnemonic_is_a_configuration_error() {
        assert!(matches!(
            super::validate_mnemonic("harvest.mnemonic", "   "),
            Err(HarvesterError::InvalidMnemonic {
                field: "harvest.mnemonic",
            })
        ));
    }

    #[test]
    fn valid_mnemonic_is_accepted() {
        let mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        assert_eq!(
            super::validate_mnemonic("harvest.mnemonic", mnemonic).unwrap(),
            mnemonic
        );
    }
}
