use lending_contracts::programs::asset_auth::{AssetAuth, AssetAuthParameters};

use simplex::transaction::FinalTransaction;

use super::common::issuance::issue_asset;
use super::common::wallet::split_first_signer_utxo;

pub(super) fn setup_asset_auth(
    context: &simplex::TestContext,
    asset_amount: u64,
    with_asset_burn: bool,
) -> anyhow::Result<(AssetAuth, AssetAuthParameters)> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    split_first_signer_utxo(context, vec![1000]);

    let asset_id = issue_asset(context, asset_amount)?;

    let asset_auth_parameters = AssetAuthParameters {
        asset_id,
        asset_amount,
        with_asset_burn,
        network: *context.get_network(),
    };

    let signer_utxos = signer.get_utxos_asset(provider.get_network().policy_asset())?;
    let utxo_to_lock = signer_utxos.first().unwrap();

    let mut ft = FinalTransaction::new();
    let asset_auth = AssetAuth::new(asset_auth_parameters);

    asset_auth.attach_creation(
        &mut ft,
        utxo_to_lock.explicit_asset(),
        utxo_to_lock.explicit_amount(),
    );

    signer.broadcast(&ft)?.wait()?;

    Ok((asset_auth, asset_auth_parameters))
}
