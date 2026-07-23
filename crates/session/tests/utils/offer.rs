#![allow(dead_code)]

use anyhow::Context;
use lending_contracts::programs::lending::LendingOfferParameters;
use lending_contracts::programs::program::SimplexProgram;
use lending_contracts::programs::script_auth::ScriptAuth;
use lending_indexer::indexer::{insert_offer, insert_offer_utxo, insert_participant_utxo};
use lending_indexer::models::{
    OfferModel, OfferParticipantModel, OfferUtxoModel, ParticipantType, UtxoType,
};
use lending_session::{CreateOfferParams, Session};
use simplex::simplicityhl::elements::Txid;
use simplex::simplicityhl::elements::hashes::Hash;
use sqlx::PgPool;
use uuid::Uuid;

use super::factory::{
    FACTORY_ISSUING_UTXOS_COUNT, FACTORY_REISSUANCE_FLAGS, create_and_broadcast_factory,
    seed_active_factory,
};

/// On-chain offer creation result used to seed the indexer (params + outpoints/scripts).
pub struct OfferCreation {
    pub parameters: LendingOfferParameters,
    pub creation_txid: Txid,
    pub pending_offer_vout: i32,
    pub borrower_nft_vout: i32,
    pub borrower_script_pubkey: Vec<u8>,
    pub lender_nft_vout: i32,
    pub lender_script_pubkey: Vec<u8>,
}

pub async fn setup_pending_offer(
    session: &Session,
    pool: &PgPool,
    params: CreateOfferParams,
) -> anyhow::Result<OfferCreation> {
    let (factory_asset_id, factory_creation_txid, auth_vout, program_vout, program_script) =
        create_and_broadcast_factory(session).await?;
    let signer_script = session.signer().get_address().script_pubkey().to_bytes();
    let factory_id = seed_active_factory(
        pool,
        signer_script,
        factory_asset_id,
        program_script,
        FACTORY_ISSUING_UTXOS_COUNT as i16,
        FACTORY_REISSUANCE_FLAGS as i64,
        factory_creation_txid,
        (factory_creation_txid, auth_vout),
        (factory_creation_txid, program_vout),
    )
    .await?;

    let offer_creation = create_and_broadcast_offer(session, params).await?;
    seed_pending_offer(pool, factory_id, &offer_creation).await?;

    Ok(offer_creation)
}

pub async fn create_and_broadcast_offer(
    session: &Session,
    params: CreateOfferParams,
) -> anyhow::Result<OfferCreation> {
    let create = session.create_offer(params).await?;
    let parameters = *create.pending_offer.get_parameters();
    let pending_offer_script = create.pending_offer.get_script_pubkey();
    let lender_nft_script =
        ScriptAuth::from_simplex_program(&create.pending_offer).get_script_pubkey();
    let borrower_script_pubkey = session.signer().get_address().script_pubkey();

    let receipt = session.signer().broadcast(&create.transaction)?;
    let creation_txid = receipt.txid();
    receipt.wait()?;

    let tx = session
        .signer()
        .get_provider()
        .fetch_transaction(&creation_txid)?;

    let pending_offer_vout =
        tx.output
            .iter()
            .position(|output| output.script_pubkey == pending_offer_script)
            .context("pending offer output is missing in the offer creation tx")? as i32;
    let borrower_nft_vout =
        tx.output
            .iter()
            .position(|output| {
                output.asset.explicit() == Some(parameters.borrower_nft_asset_id)
                    && output.script_pubkey == borrower_script_pubkey
            })
            .context("borrower NFT output is missing in the offer creation tx")? as i32;
    let lender_nft_vout =
        tx.output
            .iter()
            .position(|output| {
                output.asset.explicit() == Some(parameters.lender_nft_asset_id)
                    && output.script_pubkey == lender_nft_script
            })
            .context("lender NFT output is missing in the offer creation tx")? as i32;

    Ok(OfferCreation {
        parameters,
        creation_txid,
        pending_offer_vout,
        borrower_nft_vout,
        borrower_script_pubkey: borrower_script_pubkey.to_bytes(),
        lender_nft_vout,
        lender_script_pubkey: lender_nft_script.to_bytes(),
    })
}

pub async fn seed_pending_offer(
    pool: &PgPool,
    factory_id: Uuid,
    offer: &OfferCreation,
) -> anyhow::Result<i64> {
    let block_height = 100_u64;
    let offer_model = OfferModel::new(
        &offer.parameters,
        factory_id,
        block_height,
        offer.creation_txid,
    );
    let creation_txid = offer.creation_txid.as_byte_array().to_vec();

    let mut sql_tx = pool.begin().await?;
    let offer_id = insert_offer(&mut sql_tx, &offer_model)
        .await?
        .context("offer insert returned no id")?;

    insert_offer_utxo(
        &mut sql_tx,
        &OfferUtxoModel {
            offer_id,
            txid: creation_txid.clone(),
            vout: offer.pending_offer_vout,
            utxo_type: UtxoType::PendingOffer,
            created_at_height: block_height as i64,
            spent_txid: None,
            spent_at_height: None,
        },
    )
    .await?;

    insert_participant_utxo(
        &mut sql_tx,
        &OfferParticipantModel {
            offer_id,
            participant_type: ParticipantType::Borrower,
            script_pubkey: offer.borrower_script_pubkey.clone(),
            txid: creation_txid.clone(),
            vout: offer.borrower_nft_vout,
            created_at_height: block_height as i64,
            spent_txid: None,
            spent_at_height: None,
        },
    )
    .await?;

    insert_participant_utxo(
        &mut sql_tx,
        &OfferParticipantModel {
            offer_id,
            participant_type: ParticipantType::Lender,
            script_pubkey: offer.lender_script_pubkey.clone(),
            txid: creation_txid,
            vout: offer.lender_nft_vout,
            created_at_height: block_height as i64,
            spent_txid: None,
            spent_at_height: None,
        },
    )
    .await?;

    sql_tx.commit().await?;

    Ok(offer_id)
}
