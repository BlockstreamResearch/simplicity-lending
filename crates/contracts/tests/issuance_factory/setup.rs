use lending_contracts::programs::issuance_factory::{IssuanceFactory, IssuanceFactoryParameters};

use lending_contracts::utils::get_random_seed;
use simplex::transaction::partial_input::IssuanceInput;
use simplex::transaction::{FinalTransaction, PartialInput, RequiredSignature};

use super::common::tx_steps::finalize_and_broadcast;
use super::common::wallet::split_first_signer_utxo;

pub(super) fn setup_issuance_factory(
    context: &simplex::TestContext,
    issuing_utxos_count: u8,
    reissuance_flags: u64,
) -> anyhow::Result<(IssuanceFactory, IssuanceFactoryParameters)> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let txid = split_first_signer_utxo(context, vec![1000, 5000, 10000]);
    provider.wait(&txid)?;

    let issuance_factory_parameters = IssuanceFactoryParameters {
        issuing_utxos_count,
        reissuance_flags,
        owner_pubkey: signer.get_schnorr_public_key(),
        network: *context.get_network(),
    };
    let issuance_factory = IssuanceFactory::new(issuance_factory_parameters);

    let issuance_factory_entropy = get_random_seed();
    let issuance_factory_asset_amount = 1;

    let policy_utxo = signer.get_utxos_asset(context.get_network().policy_asset())?[0].clone();

    let mut ft = FinalTransaction::new();

    let issuance_details = ft.add_issuance_input(
        PartialInput::new(policy_utxo),
        IssuanceInput::new_issuance(issuance_factory_asset_amount, 0, issuance_factory_entropy),
        RequiredSignature::NativeEcdsa,
    );

    issuance_factory.attach_creation(
        &mut ft,
        issuance_details.asset_id,
        issuance_factory_asset_amount,
    );

    let txid = finalize_and_broadcast(context, &ft)?;

    provider.wait(&txid)?;

    Ok((issuance_factory, issuance_factory_parameters))
}
