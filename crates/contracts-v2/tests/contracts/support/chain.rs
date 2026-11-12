use simplex::TestContext;
use simplex::simplicityhl::elements::{AssetId, OutPoint, Script, Txid};
use simplex::transaction::partial_input::IssuanceInput;
use simplex::transaction::{
    ChangeOutput, FinalTransaction, NativeSignature, PartialInput, PartialOutput, UTXO,
};

/// The default signer's script, the one its UTXOs are locked to.
pub fn signer_script(context: &TestContext) -> Script {
    context.get_default_signer().get_address().script_pubkey()
}

/// Any explicit UTXO of `asset` the default signer holds.
pub fn signer_utxo(context: &TestContext, asset: AssetId) -> anyhow::Result<UTXO> {
    context
        .get_default_signer()
        .get_utxos_asset(asset)?
        .into_iter()
        .find(UTXO::is_explicit)
        .ok_or_else(|| anyhow::anyhow!("the signer holds no explicit UTXO of {asset}"))
}

/// `ft` with the change sent to the default signer explicitly.
pub fn with_explicit_change(context: &TestContext, ft: &FinalTransaction) -> FinalTransaction {
    let mut ft = ft.clone();

    if ft.change().is_none() {
        ft.add_change(ChangeOutput::new(signer_script(context)));
    }

    ft
}

/// Broadcasts `ft` and waits for it to be confirmed.
pub fn broadcast(context: &TestContext, ft: &FinalTransaction) -> anyhow::Result<Txid> {
    let receipt = context
        .get_default_signer()
        .broadcast(&with_explicit_change(context, ft))?;
    receipt.wait()?;

    Ok(receipt.txid())
}

/// Broadcasts `ft` and returns its output locked to `script`.
pub fn create(
    context: &TestContext,
    ft: &FinalTransaction,
    script: &Script,
) -> anyhow::Result<UTXO> {
    let txid = broadcast(context, ft)?;

    context
        .get_default_provider()
        .fetch_scripthash_utxos(script)?
        .into_iter()
        .find(|utxo| utxo.outpoint.txid == txid)
        .ok_or_else(|| anyhow::anyhow!("{txid} created no output locked to {script}"))
}

/// Issues `amount` of a new asset to the default signer.
pub fn issue_asset(context: &TestContext, amount: u64) -> anyhow::Result<AssetId> {
    let funding = signer_utxo(context, context.get_network().policy_asset())?;

    let mut ft = FinalTransaction::new();

    let issuance = ft.add_issuance_input(
        PartialInput::new(funding),
        IssuanceInput::new_issuance(amount, 0, simplex::rand::random()),
        Some(NativeSignature::Ecdsa),
    );

    ft.add_output(PartialOutput::new(
        signer_script(context),
        amount,
        issuance.asset_id,
    ));

    broadcast(context, &ft)?;

    Ok(issuance.asset_id)
}

/// Sends `amount` of the policy asset to the default signer as an explicit UTXO of its own.
pub fn fund_signer(context: &TestContext, amount: u64) -> anyhow::Result<UTXO> {
    let script = signer_script(context);

    let mut ft = FinalTransaction::new();
    ft.add_output(PartialOutput::new(
        script.clone(),
        amount,
        context.get_network().policy_asset(),
    ));

    let outpoint = OutPoint::new(broadcast(context, &ft)?, 0);

    context
        .get_default_provider()
        .fetch_scripthash_utxos(&script)?
        .into_iter()
        .find(|utxo| utxo.outpoint == outpoint)
        .ok_or_else(|| anyhow::anyhow!("{outpoint} is not a signer UTXO"))
}
