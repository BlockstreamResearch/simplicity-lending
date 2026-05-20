use lending_contracts::programs::program::{MetadataProgram, SimplexProgram};
use lending_contracts::utils::op_return_payload;
use simplex::simplicityhl::elements::Txid;

use lending_contracts::programs::lending::{
    OfferParameters, PendingLendingOffer, PendingLendingOfferParameters,
};

use super::common::wallet::split_first_signer_utxo;
use super::setup::{setup_issuance_factory, setup_pending_lending_offer};

fn default_pending_offer_setup(
    context: &simplex::TestContext,
) -> anyhow::Result<(Txid, PendingLendingOffer, PendingLendingOfferParameters)> {
    let provider = context.get_default_provider();

    split_first_signer_utxo(context, vec![5000, 10000]);

    let issuance_factory = setup_issuance_factory(context)?;

    let principal_asset_amount = 20000;
    let current_height = provider.fetch_tip_height()?;

    let offer_parameters = OfferParameters {
        collateral_amount: 3000,
        principal_amount: 10000,
        loan_expiration_time: current_height + 60,
        principal_interest_rate: 1000,
    };

    setup_pending_lending_offer(
        context,
        offer_parameters,
        issuance_factory,
        principal_asset_amount,
    )
}

#[simplex::test]
fn creates_pending_lending_offer_with_creation_metadata(
    context: simplex::TestContext,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let (lending_offer_creation_txid, _, lending_offer_parameters) =
        default_pending_offer_setup(&context)?;

    let lending_offer_creation_tx = provider.fetch_transaction(&lending_offer_creation_txid)?;
    let op_return_data = op_return_payload(&lending_offer_creation_tx.output[4].script_pubkey)
        .unwrap()
        .to_vec();

    assert!(lending_offer_creation_tx.output[4].is_null_data());
    assert_eq!(op_return_data.len(), 80);
    assert_eq!(
        &op_return_data[0..4],
        PendingLendingOffer::get_program_id().as_slice()
    );
    assert_eq!(
        &op_return_data[4..36],
        lending_offer_parameters
            .borrower_pubkey
            .serialize()
            .as_slice()
    );
    assert_eq!(
        &op_return_data[36..68],
        lending_offer_parameters
            .principal_asset_id
            .into_inner()
            .0
            .as_slice()
    );
    assert_eq!(
        &op_return_data[68..76],
        lending_offer_parameters
            .offer_parameters
            .principal_amount
            .to_le_bytes()
            .to_vec(),
    );
    assert_eq!(
        &op_return_data[76..80],
        lending_offer_parameters
            .offer_parameters
            .loan_expiration_time
            .to_le_bytes()
            .to_vec(),
    );

    Ok(())
}

#[simplex::test]
fn decodes_lending_offer_creation_metadata(context: simplex::TestContext) -> anyhow::Result<()> {
    let provider = context.get_default_provider();
    let (lending_offer_creation_txid, _, lending_offer_parameters) =
        default_pending_offer_setup(&context)?;

    let lending_offer_creation_tx = provider.fetch_transaction(&lending_offer_creation_txid)?;

    let op_return_data = op_return_payload(&lending_offer_creation_tx.output[4].script_pubkey)
        .unwrap()
        .to_vec();
    let decoded_metadata = PendingLendingOffer::decode_metadata_op_return(op_return_data)?;

    assert_eq!(
        decoded_metadata.program_id,
        PendingLendingOffer::get_program_id()
    );
    assert_eq!(
        decoded_metadata.borrower_pubkey,
        lending_offer_parameters.borrower_pubkey
    );
    assert_eq!(
        decoded_metadata.principal_asset_id,
        lending_offer_parameters.principal_asset_id
    );
    assert_eq!(
        decoded_metadata.principal_amount,
        lending_offer_parameters.offer_parameters.principal_amount
    );
    assert_eq!(
        decoded_metadata.loan_expiration_time,
        lending_offer_parameters
            .offer_parameters
            .loan_expiration_time
    );

    Ok(())
}
