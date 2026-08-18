use anyhow::Context;
use lending_contracts::programs::issuance_factory::{IssuanceFactory, IssuanceFactoryParameters};
use lending_contracts::programs::program::SimplexProgram;
use lending_indexer::indexer::{insert_factory, insert_factory_auth_utxo, insert_factory_utxo};
use lending_indexer::models::{FactoryAuthModel, FactoryModel, FactoryStatus, FactoryUtxoModel};
use lending_session::Session;
use simplex::provider::SimplicityNetwork;
use simplex::simplicityhl::elements::hashes::Hash;
use simplex::simplicityhl::elements::{AssetId, Txid};
use sqlx::PgPool;
use uuid::Uuid;

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
