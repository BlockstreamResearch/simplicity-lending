#![allow(dead_code)]

use anyhow::Context;
use lending_contracts::programs::issuance_factory::{IssuanceFactory, IssuanceFactoryParameters};
use lending_contracts::programs::program::SimplexProgram;
use lending_indexer::indexer::{
    insert_factory, insert_factory_auth_utxo, insert_factory_utxo, spend_factory_auth_utxo,
    spend_factory_utxo, update_factory_status,
};
use lending_indexer::models::{FactoryAuthModel, FactoryModel, FactoryStatus, FactoryUtxoModel};
use lending_session::Session;
use simplex::provider::{ProviderTrait, SimplicityNetwork};
use simplex::simplicityhl::elements::hashes::Hash;
use simplex::simplicityhl::elements::{AssetId, OutPoint, Txid};
use simplex::transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature};
use sqlx::PgPool;
use uuid::Uuid;

const FACTORY_TRACK_BLOCK_HEIGHT: u64 = 120;
const FACTORY_TRANSFER_BLOCK_HEIGHT: u64 = 130;
const FACTORY_REMOVE_BLOCK_HEIGHT: u64 = 140;

pub const FACTORY_ISSUING_UTXOS_COUNT: u8 = 2;
pub const FACTORY_REISSUANCE_FLAGS: u64 = 0;

pub fn issuance_factory_for_network(network: SimplicityNetwork) -> IssuanceFactory {
    IssuanceFactory::new(IssuanceFactoryParameters {
        issuing_utxos_count: FACTORY_ISSUING_UTXOS_COUNT,
        reissuance_flags: FACTORY_REISSUANCE_FLAGS,
        network,
    })
}

#[allow(clippy::too_many_arguments)]
pub async fn seed_active_factory(
    pool: &PgPool,
    script_pubkey: Vec<u8>,
    factory_asset_id: AssetId,
    program_script_pubkey: Vec<u8>,
    issuing_utxos_count: i16,
    reissuance_flags: i64,
    created_at_txid: Txid,
    auth_outpoint: (Txid, i32),
    program_outpoint: (Txid, i32),
) -> anyhow::Result<Uuid> {
    let factory_id = Uuid::new_v4();
    let created_at_height = 100_i64;

    let factory = FactoryModel {
        id: factory_id,
        factory_asset_id: factory_asset_id.into_inner().0.to_vec(),
        program_script_pubkey,
        issuing_utxos_count,
        reissuance_flags,
        current_status: FactoryStatus::Active,
        created_at_height,
        created_at_txid: created_at_txid.as_byte_array().to_vec(),
    };

    let auth_utxo = FactoryAuthModel {
        factory_id,
        script_pubkey,
        txid: auth_outpoint.0.as_byte_array().to_vec(),
        vout: auth_outpoint.1,
        created_at_height,
        spent_txid: None,
        spent_at_height: None,
    };

    let program_utxo = FactoryUtxoModel {
        factory_id,
        txid: program_outpoint.0.as_byte_array().to_vec(),
        vout: program_outpoint.1,
        created_at_height,
        spent_txid: None,
        spent_at_height: None,
    };

    let mut sql_tx = pool.begin().await?;
    insert_factory(&mut sql_tx, &factory).await?;
    insert_factory_auth_utxo(&mut sql_tx, &auth_utxo).await?;
    insert_factory_utxo(&mut sql_tx, &program_utxo).await?;
    sql_tx.commit().await?;

    Ok(factory_id)
}

pub async fn create_and_broadcast_factory(
    session: &Session,
) -> anyhow::Result<(AssetId, Txid, i32, i32, Vec<u8>)> {
    let create = session.create_factory().await?;
    let factory_asset_id = create.factory_asset_id;
    let signer_script = session.signer().get_address().script_pubkey();
    let factory_program_script =
        issuance_factory_for_network(session.network()).get_script_pubkey();

    let create_receipt = session.signer().broadcast(&create.transaction)?;
    let create_txid = create_receipt.txid();
    create_receipt.wait()?;

    let tx = session
        .signer()
        .get_provider()?
        .fetch_transaction(&create_txid)?;
    let auth_vout = tx
        .output
        .iter()
        .position(|output| {
            output.asset.explicit() == Some(factory_asset_id)
                && output.script_pubkey == signer_script
        })
        .context("auth NFT output is missing in the creation tx")? as i32;
    let program_vout =
        tx.output
            .iter()
            .position(|output| {
                output.asset.explicit() == Some(factory_asset_id)
                    && output.script_pubkey == factory_program_script
            })
            .context("factory program output is missing in the creation tx")? as i32;

    Ok((
        factory_asset_id,
        create_txid,
        auth_vout,
        program_vout,
        factory_program_script.to_bytes(),
    ))
}

#[derive(Debug, Clone)]
pub struct IndexedFactoryState {
    pub id: Uuid,
    pub asset_id: AssetId,
    pub program_script_pubkey: Vec<u8>,
    pub auth_outpoint: OutPoint,
    pub program_outpoint: OutPoint,
}

pub async fn create_active_factory(
    session: &Session,
    pool: &PgPool,
) -> anyhow::Result<IndexedFactoryState> {
    let (factory_asset_id, creation_txid, auth_vout, program_vout, program_script_pubkey) =
        create_and_broadcast_factory(session).await?;
    let factory_id = seed_active_factory(
        pool,
        session.signer().get_address().script_pubkey().to_bytes(),
        factory_asset_id,
        program_script_pubkey.clone(),
        FACTORY_ISSUING_UTXOS_COUNT as i16,
        FACTORY_REISSUANCE_FLAGS as i64,
        creation_txid,
        (creation_txid, auth_vout),
        (creation_txid, program_vout),
    )
    .await?;

    Ok(IndexedFactoryState {
        id: factory_id,
        asset_id: factory_asset_id,
        program_script_pubkey,
        auth_outpoint: OutPoint::new(creation_txid, auth_vout as u32),
        program_outpoint: OutPoint::new(creation_txid, program_vout as u32),
    })
}

pub async fn sync_factory_after_offer_creation(
    session: &Session,
    pool: &PgPool,
    state: &mut IndexedFactoryState,
    offer_creation_txid: Txid,
) -> anyhow::Result<()> {
    let tx = session
        .provider()
        .fetch_transaction(&offer_creation_txid)
        .context("fetch offer creation tx for factory sync")?;
    let signer_script_pubkey = session.signer().get_address().script_pubkey();

    let new_auth_vout =
        tx.output
            .iter()
            .position(|output| {
                output.asset.explicit() == Some(state.asset_id)
                    && output.script_pubkey == signer_script_pubkey
            })
            .context("new auth NFT output is missing in offer creation tx")? as i32;
    let new_program_vout =
        tx.output
            .iter()
            .position(|output| {
                output.asset.explicit() == Some(state.asset_id)
                    && output.script_pubkey.to_bytes() == state.program_script_pubkey
            })
            .context("new factory program output is missing in offer creation tx")? as i32;

    let mut sql_tx = pool.begin().await?;
    spend_factory_auth_utxo(
        &mut sql_tx,
        &state.auth_outpoint,
        FACTORY_TRACK_BLOCK_HEIGHT,
        offer_creation_txid,
    )
    .await?;
    spend_factory_utxo(
        &mut sql_tx,
        &state.program_outpoint,
        FACTORY_TRACK_BLOCK_HEIGHT,
        offer_creation_txid,
    )
    .await?;

    insert_factory_auth_utxo(
        &mut sql_tx,
        &FactoryAuthModel {
            factory_id: state.id,
            script_pubkey: signer_script_pubkey.to_bytes(),
            txid: offer_creation_txid.as_byte_array().to_vec(),
            vout: new_auth_vout,
            created_at_height: FACTORY_TRACK_BLOCK_HEIGHT as i64,
            spent_txid: None,
            spent_at_height: None,
        },
    )
    .await?;
    insert_factory_utxo(
        &mut sql_tx,
        &FactoryUtxoModel {
            factory_id: state.id,
            txid: offer_creation_txid.as_byte_array().to_vec(),
            vout: new_program_vout,
            created_at_height: FACTORY_TRACK_BLOCK_HEIGHT as i64,
            spent_txid: None,
            spent_at_height: None,
        },
    )
    .await?;
    sql_tx.commit().await?;

    state.auth_outpoint = OutPoint::new(offer_creation_txid, new_auth_vout as u32);
    state.program_outpoint = OutPoint::new(offer_creation_txid, new_program_vout as u32);
    Ok(())
}

fn transfer_factory_auth(
    factory_owner: &Session,
    recipient: &Session,
    factory: &IndexedFactoryState,
) -> anyhow::Result<(Txid, i32)> {
    let policy_asset = factory_owner.network().policy_asset();
    let policy_utxo = factory_owner
        .signer()
        .get_utxos_asset(policy_asset)?
        .into_iter()
        .next()
        .context("owner policy UTXO not found for auth transfer fee")?;
    let policy_change = policy_utxo
        .amount()
        .checked_sub(500)
        .context("owner policy UTXO too small to fund auth transfer fee")?;
    let owner_auth_utxo = factory_owner
        .signer()
        .get_utxos_asset(factory.asset_id)?
        .into_iter()
        .find(|utxo| utxo.outpoint == factory.auth_outpoint)
        .context("owner auth NFT UTXO not found for transfer")?;
    let recipient_script_pubkey = recipient.signer().get_address().script_pubkey();

    let mut tx = FinalTransaction::new();
    tx.add_input(
        PartialInput::new(owner_auth_utxo),
        RequiredSignature::NativeEcdsa,
    );
    tx.add_input(
        PartialInput::new(policy_utxo),
        RequiredSignature::NativeEcdsa,
    );
    tx.add_output(PartialOutput::new(
        recipient_script_pubkey.clone(),
        1,
        factory.asset_id,
    ));
    tx.add_output(PartialOutput::new(
        factory_owner.signer().get_address().script_pubkey(),
        policy_change,
        policy_asset,
    ));

    let receipt = factory_owner.signer().broadcast(&tx)?;
    let transfer_txid = receipt.txid();
    receipt.wait()?;

    let chain_tx = factory_owner
        .provider()
        .fetch_transaction(&transfer_txid)
        .context("fetch transfer tx for auth output lookup")?;
    let transfer_vout = chain_tx
        .output
        .iter()
        .position(|output| {
            output.asset.explicit() == Some(factory.asset_id)
                && output.script_pubkey == recipient_script_pubkey
        })
        .context("recipient auth NFT output is missing in transfer tx")?
        as i32;

    Ok((transfer_txid, transfer_vout))
}

async fn sync_factory_auth_transfer(
    pool: &PgPool,
    factory: &mut IndexedFactoryState,
    transfer_txid: Txid,
    transfer_vout: i32,
    recipient_script_pubkey: Vec<u8>,
) -> anyhow::Result<()> {
    let mut sql_tx = pool.begin().await?;
    spend_factory_auth_utxo(
        &mut sql_tx,
        &factory.auth_outpoint,
        FACTORY_TRANSFER_BLOCK_HEIGHT,
        transfer_txid,
    )
    .await?;
    insert_factory_auth_utxo(
        &mut sql_tx,
        &FactoryAuthModel {
            factory_id: factory.id,
            script_pubkey: recipient_script_pubkey,
            txid: transfer_txid.as_byte_array().to_vec(),
            vout: transfer_vout,
            created_at_height: FACTORY_TRANSFER_BLOCK_HEIGHT as i64,
            spent_txid: None,
            spent_at_height: None,
        },
    )
    .await?;
    sql_tx.commit().await?;

    factory.auth_outpoint = OutPoint::new(transfer_txid, transfer_vout as u32);
    Ok(())
}

pub async fn transfer_factory_auth_and_index(
    factory_owner: &Session,
    recipient: &Session,
    pool: &PgPool,
    factory: &mut IndexedFactoryState,
) -> anyhow::Result<()> {
    let (transfer_txid, transfer_vout) = transfer_factory_auth(factory_owner, recipient, factory)?;
    sync_factory_auth_transfer(
        pool,
        factory,
        transfer_txid,
        transfer_vout,
        recipient.signer().get_address().script_pubkey().to_bytes(),
    )
    .await
}

pub async fn remove_factory_and_index_it(
    session: &Session,
    pool: &PgPool,
    factory: &IndexedFactoryState,
) -> anyhow::Result<()> {
    let remove_tx = session.remove_factory(factory.asset_id).await?;
    let receipt = session.signer().broadcast(&remove_tx)?;
    let remove_txid = receipt.txid();
    receipt.wait()?;

    let mut sql_tx = pool.begin().await?;
    spend_factory_auth_utxo(
        &mut sql_tx,
        &factory.auth_outpoint,
        FACTORY_REMOVE_BLOCK_HEIGHT,
        remove_txid,
    )
    .await?;
    spend_factory_utxo(
        &mut sql_tx,
        &factory.program_outpoint,
        FACTORY_REMOVE_BLOCK_HEIGHT,
        remove_txid,
    )
    .await?;
    update_factory_status(&mut sql_tx, factory.id, FactoryStatus::Removed).await?;
    sql_tx.commit().await?;

    Ok(())
}
