mod utils;

use anyhow::Context;
use lending_contracts::programs::program::SimplexProgram;
use lending_contracts::utils::get_random_seed;
use lending_session::SessionError;
use serial_test::serial;
use simplex::provider::SimplicityNetwork;
use simplex::signer::Signer;
use simplex::simplicityhl::elements::hashes::Hash;
use simplex::simplicityhl::elements::{AssetId, Txid};
use simplex::transaction::partial_input::IssuanceInput;
use simplex::transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature};

use utils::{
    FACTORY_ISSUING_UTXOS_COUNT, FACTORY_REISSUANCE_FLAGS, build_session,
    build_session_with_signer, create_and_broadcast_factory, issuance_factory_for_network,
    seed_active_factory, setup_it_context_pool, start_indexer_api,
};

fn issue_only_program_factory_utxo(
    signer: &Signer,
    network: SimplicityNetwork,
) -> anyhow::Result<(AssetId, Txid, i32, Vec<u8>)> {
    let factory = issuance_factory_for_network(network);
    let factory_program_script = factory.get_script_pubkey();
    let policy_utxo = signer
        .get_utxos_asset(network.policy_asset())?
        .into_iter()
        .next()
        .context("expected at least one policy UTXO for issuance")?;

    let mut tx = FinalTransaction::new();
    let issuance = tx.add_issuance_input(
        PartialInput::new(policy_utxo),
        IssuanceInput::new_issuance(1, 0, get_random_seed()),
        RequiredSignature::NativeEcdsa,
    );
    tx.add_output(PartialOutput::new(
        factory_program_script.clone(),
        1,
        issuance.asset_id,
    ));

    let receipt = signer.broadcast(&tx)?;
    let txid = receipt.txid();
    receipt.wait()?;

    let chain_tx = signer.get_provider().fetch_transaction(&txid)?;
    let program_vout = chain_tx
        .output
        .iter()
        .position(|output| {
            output.asset.explicit() == Some(issuance.asset_id)
                && output.script_pubkey == factory_program_script
        })
        .context("expected program output in synthetic issuance tx")? as i32;

    Ok((
        issuance.asset_id,
        txid,
        program_vout,
        factory_program_script.to_bytes(),
    ))
}

#[tokio::test]
#[serial]
async fn create_factory_builds_and_broadcasts_transaction() -> anyhow::Result<()> {
    let Some((context, pool)) = setup_it_context_pool().await? else {
        return Ok(());
    };
    let (indexer_url, server_handle) = start_indexer_api(pool).await?;

    let session = build_session(&context, &indexer_url);
    let create = session.create_factory().await?;
    let factory_program_script =
        issuance_factory_for_network(session.network()).get_script_pubkey();

    assert_eq!(create.transaction.n_inputs(), 1);
    assert!(
        create
            .transaction
            .inputs()
            .iter()
            .any(|input| input.issuance_input.is_some()),
        "factory creation tx must include an issuance input"
    );
    assert!(
        create
            .transaction
            .outputs()
            .iter()
            .any(|output| output.asset == create.factory_asset_id && output.amount == 1),
        "factory creation tx must include auth NFT output"
    );
    assert!(
        create.transaction.outputs().iter().any(|output| {
            output.asset == create.factory_asset_id
                && output.script_pubkey == factory_program_script
        }),
        "factory creation tx must include factory program output"
    );

    let receipt = session.signer().broadcast(&create.transaction)?;
    receipt.wait()?;

    let auth_nft_utxos = session.signer().get_utxos_asset(create.factory_asset_id)?;
    assert!(
        !auth_nft_utxos.is_empty(),
        "wallet must own at least one auth NFT output after creation"
    );

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn create_factory_returns_no_policy_utxos_for_unfunded_signer() -> anyhow::Result<()> {
    let Some((context, pool)) = setup_it_context_pool().await? else {
        return Ok(());
    };
    let (indexer_url, server_handle) = start_indexer_api(pool).await?;

    let unfunded_signer = context.random_signer();
    let session = build_session_with_signer(&context, unfunded_signer, &indexer_url);
    let result = session.create_factory().await;

    assert!(matches!(result, Err(SessionError::NoPolicyUtxos)));

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn create_factory_rejects_when_indexer_reports_existing_factory() -> anyhow::Result<()> {
    let Some((context, pool)) = setup_it_context_pool().await? else {
        return Ok(());
    };

    let signer = context.create_signer(&context.get_config().mnemonic);
    let signer_script = signer.get_address().script_pubkey().to_bytes();
    let existing_factory_asset = AssetId::from_slice(&[7_u8; 32]).expect("valid asset id");
    let fake_txid = Txid::from_slice(&[0x11_u8; 32]).expect("valid txid");
    let program_script = issuance_factory_for_network(*context.get_network())
        .get_script_pubkey()
        .to_bytes();

    seed_active_factory(
        &pool,
        signer_script,
        existing_factory_asset,
        program_script,
        FACTORY_ISSUING_UTXOS_COUNT as i16,
        FACTORY_REISSUANCE_FLAGS as i64,
        fake_txid,
        (fake_txid, 0),
        (fake_txid, 1),
    )
    .await?;

    let (indexer_url, server_handle) = start_indexer_api(pool).await?;
    let session = build_session(&context, &indexer_url);
    let result = session.create_factory().await;

    assert!(matches!(
        result,
        Err(SessionError::BorrowerAccountAlreadyExists)
    ));

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn remove_factory_builds_and_broadcasts_transaction_when_factory_exists() -> anyhow::Result<()>
{
    let Some((context, pool)) = setup_it_context_pool().await? else {
        return Ok(());
    };
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let session = build_session(&context, &indexer_url);

    let (factory_asset_id, creation_txid, auth_vout, program_vout, program_script) =
        create_and_broadcast_factory(&session).await?;
    let signer_script = session.signer().get_address().script_pubkey().to_bytes();

    seed_active_factory(
        &pool,
        signer_script,
        factory_asset_id,
        program_script,
        FACTORY_ISSUING_UTXOS_COUNT as i16,
        FACTORY_REISSUANCE_FLAGS as i64,
        creation_txid,
        (creation_txid, auth_vout),
        (creation_txid, program_vout),
    )
    .await?;

    let remove_tx = session.remove_factory(factory_asset_id).await?;
    assert_eq!(remove_tx.n_inputs(), 2);

    let remove_receipt = session.signer().broadcast(&remove_tx)?;
    remove_receipt.wait()?;

    let auth_nft_utxos_after = session.signer().get_utxos_asset(factory_asset_id)?;
    assert!(
        auth_nft_utxos_after.is_empty(),
        "auth NFT should be consumed by remove transaction"
    );

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn remove_factory_returns_factory_program_utxo_not_found_when_outpoint_mismatches()
-> anyhow::Result<()> {
    let Some((context, pool)) = setup_it_context_pool().await? else {
        return Ok(());
    };
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let session = build_session(&context, &indexer_url);

    let (factory_asset_id, creation_txid, auth_vout, program_vout, program_script) =
        create_and_broadcast_factory(&session).await?;
    let signer_script = session.signer().get_address().script_pubkey().to_bytes();

    seed_active_factory(
        &pool,
        signer_script,
        factory_asset_id,
        program_script,
        FACTORY_ISSUING_UTXOS_COUNT as i16,
        FACTORY_REISSUANCE_FLAGS as i64,
        creation_txid,
        (creation_txid, auth_vout),
        (creation_txid, program_vout + 1000),
    )
    .await?;

    let result = session.remove_factory(factory_asset_id).await;
    assert!(matches!(
        result,
        Err(SessionError::FactoryProgramUtxoNotFound)
    ));

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn remove_factory_returns_auth_nft_utxo_not_found_when_wallet_missing_auth_token()
-> anyhow::Result<()> {
    let Some((context, pool)) = setup_it_context_pool().await? else {
        return Ok(());
    };
    let (indexer_url, server_handle) = start_indexer_api(pool.clone()).await?;
    let session = build_session(&context, &indexer_url);

    let (factory_asset_id, creation_txid, program_vout, program_script) =
        issue_only_program_factory_utxo(session.signer(), session.network())?;
    let signer_script = session.signer().get_address().script_pubkey().to_bytes();

    seed_active_factory(
        &pool,
        signer_script,
        factory_asset_id,
        program_script,
        FACTORY_ISSUING_UTXOS_COUNT as i16,
        FACTORY_REISSUANCE_FLAGS as i64,
        creation_txid,
        (creation_txid, 0),
        (creation_txid, program_vout),
    )
    .await?;

    let result = session.remove_factory(factory_asset_id).await;
    assert!(matches!(result, Err(SessionError::AuthNftUtxoNotFound)));

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn remove_factory_returns_invalid_state_for_oversized_issuing_utxos_count()
-> anyhow::Result<()> {
    let Some((context, pool)) = setup_it_context_pool().await? else {
        return Ok(());
    };

    let signer = context.create_signer(&context.get_config().mnemonic);
    let signer_script = signer.get_address().script_pubkey().to_bytes();
    let factory_asset_id = AssetId::from_slice(&[0x13_u8; 32]).expect("valid asset id");
    let fake_txid = Txid::from_slice(&[0x23_u8; 32]).expect("valid txid");
    let program_script = issuance_factory_for_network(*context.get_network())
        .get_script_pubkey()
        .to_bytes();

    seed_active_factory(
        &pool,
        signer_script,
        factory_asset_id,
        program_script,
        300,
        FACTORY_REISSUANCE_FLAGS as i64,
        fake_txid,
        (fake_txid, 0),
        (fake_txid, 1),
    )
    .await?;

    let (indexer_url, server_handle) = start_indexer_api(pool).await?;
    let session = build_session(&context, &indexer_url);
    let result = session.remove_factory(factory_asset_id).await;

    assert!(matches!(result, Err(SessionError::InvalidState)));

    server_handle.abort();
    Ok(())
}

#[tokio::test]
#[serial]
async fn remove_factory_reports_not_found_for_missing_asset() -> anyhow::Result<()> {
    let Some((context, pool)) = setup_it_context_pool().await? else {
        return Ok(());
    };
    let (indexer_url, server_handle) = start_indexer_api(pool).await?;

    let session = build_session(&context, &indexer_url);
    let unknown_factory_asset = AssetId::from_slice(&[9_u8; 32]).expect("valid asset id");
    let result = session.remove_factory(unknown_factory_asset).await;

    assert!(matches!(result, Err(SessionError::FactoryNotFound)));

    server_handle.abort();
    Ok(())
}
