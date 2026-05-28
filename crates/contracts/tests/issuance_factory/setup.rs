use lending_contracts::programs::issuance_factory::{IssuanceFactory, IssuanceFactoryParameters};

use lending_contracts::utils::get_random_seed;
use simplex::simplicityhl::elements::AssetId;
use simplex::transaction::partial_input::IssuanceInput;
use simplex::transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature};

use super::common::wallet::split_first_signer_utxo;

pub(super) fn setup_issuance_factory(
    context: &simplex::TestContext,
    issuing_utxos_count: u8,
    reissuance_flags: u64,
) -> anyhow::Result<(AssetId, IssuanceFactory, IssuanceFactoryParameters)> {
    let signer = context.get_default_signer();

    split_first_signer_utxo(context, vec![1000, 5000, 10000]);

    let issuance_factory_parameters = IssuanceFactoryParameters {
        issuing_utxos_count,
        reissuance_flags,
        network: *context.get_network(),
    };
    let issuance_factory = IssuanceFactory::new(issuance_factory_parameters);

    let issuance_factory_entropy = get_random_seed();
    let issuance_factory_asset_amount = 2;

    let policy_utxo = signer.get_utxos_asset(context.get_network().policy_asset())?[0].clone();

    let mut ft = FinalTransaction::new();

    let issuance_details = ft.add_issuance_input(
        PartialInput::new(policy_utxo),
        IssuanceInput::new_issuance(issuance_factory_asset_amount, 0, issuance_factory_entropy),
        RequiredSignature::NativeEcdsa,
    );

    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        1,
        issuance_details.asset_id,
    ));

    issuance_factory.attach_creation(&mut ft, issuance_details.asset_id, 1);

    signer.broadcast(&ft)?.wait()?;

    Ok((
        issuance_details.asset_id,
        issuance_factory,
        issuance_factory_parameters,
    ))
}
