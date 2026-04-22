use lending_contracts::programs::lending::Lending;
use lending_contracts::{programs::lending::LendingParameters, utils::LendingOfferParameters};
use simplex::simplicityhl::elements::Txid;
use simplex::transaction::{FinalTransaction, PartialInput, RequiredSignature};

use super::common::issuance::{issue_asset, issue_preparation_utxos_tx, issue_utility_nfts_tx};
use super::common::tx_steps::{finalize_and_broadcast, mine_blocks_with_self_send};
use super::common::wallet::split_first_signer_utxo;

pub(super) fn mine_until_height(
    context: &simplex::TestContext,
    target_height: u32,
) -> anyhow::Result<()> {
    let current_height = context.get_default_provider().fetch_tip_height()?;
    if current_height < target_height {
        let blocks_to_mine = target_height - current_height;
        let _ = mine_blocks_with_self_send(context, blocks_to_mine, 1_000)?;
    }

    Ok(())
}

pub(super) fn setup_lending(
    context: &simplex::TestContext,
    offer_parameters: LendingOfferParameters,
    principal_asset_amount: u64,
) -> anyhow::Result<(Txid, Lending, LendingParameters)> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let txid = split_first_signer_utxo(
        context,
        vec![1000, 2000, offer_parameters.collateral_amount],
    );
    provider.wait(&txid)?;

    let (txid, principal_asset_id) = issue_asset(context, principal_asset_amount)?;
    provider.wait(&txid)?;

    let (txid, preparation_asset_id) = issue_preparation_utxos_tx(context)?;
    provider.wait(&txid)?;

    let txid = issue_utility_nfts_tx(context, &offer_parameters, preparation_asset_id)?;
    provider.wait(&txid)?;

    let utility_nfts_creation_tx = provider.fetch_transaction(&txid)?;

    let first_parameters_nft_asset_id =
        utility_nfts_creation_tx.output[0].asset.explicit().unwrap();
    let second_parameters_nft_asset_id =
        utility_nfts_creation_tx.output[1].asset.explicit().unwrap();
    let borrower_nft_asset_id = utility_nfts_creation_tx.output[2].asset.explicit().unwrap();
    let lender_nft_asset_id = utility_nfts_creation_tx.output[3].asset.explicit().unwrap();

    let lending_parameters = LendingParameters {
        collateral_asset_id: provider.get_network().policy_asset(),
        first_parameters_nft_asset_id,
        second_parameters_nft_asset_id,
        borrower_nft_asset_id,
        lender_nft_asset_id,
        offer_parameters,
        principal_asset_id,
        network: *provider.get_network(),
    };

    let lending = Lending::new(lending_parameters);

    let collateral_utxo = signer.get_utxos_filter(
        &|utxo| {
            utxo.explicit_asset() == lending_parameters.collateral_asset_id
                && utxo.explicit_amount() >= lending_parameters.offer_parameters.collateral_amount
        },
        &|_| true,
    )?[0]
        .clone();

    let first_parameters_utxo = signer.get_utxos_asset(first_parameters_nft_asset_id)?[0].clone();
    let second_parameters_utxo = signer.get_utxos_asset(second_parameters_nft_asset_id)?[0].clone();

    let mut ft = FinalTransaction::new();

    ft.add_input(
        PartialInput::new(collateral_utxo.clone()),
        RequiredSignature::NativeEcdsa,
    );
    ft.add_input(
        PartialInput::new(first_parameters_utxo.clone()),
        RequiredSignature::NativeEcdsa,
    );
    ft.add_input(
        PartialInput::new(second_parameters_utxo.clone()),
        RequiredSignature::NativeEcdsa,
    );

    lending.attach_creation(&mut ft, first_parameters_utxo, second_parameters_utxo);

    let txid = finalize_and_broadcast(context, &ft)?;
    provider.wait(&txid)?;

    Ok((txid, lending, lending_parameters))
}
