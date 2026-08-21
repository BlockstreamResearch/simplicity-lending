#![allow(dead_code)]

use anyhow::Context;
use lending_contracts::programs::lending::LendingOfferParameters;
use lending_contracts::programs::program::SimplexProgram;
use lending_contracts::programs::script_auth::ScriptAuth;
use lending_indexer::indexer::{
    insert_offer, insert_offer_utxo, insert_offer_vault, insert_participant_utxo, spend_offer_utxo,
    spend_participant_utxo, update_offer_status,
};
use lending_indexer::models::{
    OfferModel, OfferParticipantModel, OfferStatus, OfferUtxoModel, OfferVaultModel,
    ParticipantType, UtxoType, VaultType,
};
use lending_session::{AcceptOfferTx, CreateOfferParams, OfferParameters, Session};
use simplex::simplicityhl::elements::hashes::Hash;
use simplex::simplicityhl::elements::{AssetId, OutPoint, Txid};
use sqlx::PgPool;
use uuid::Uuid;

use super::factory::{
    FACTORY_ISSUING_UTXOS_COUNT, FACTORY_REISSUANCE_FLAGS, create_and_broadcast_factory,
    seed_active_factory,
};

pub const TEST_PRINCIPAL_AMOUNT: u64 = 10_000;
pub const DEFAULT_LOAN_EXPIRATION_OFFSET: u32 = 60;

pub fn dummy_principal_asset_id() -> AssetId {
    AssetId::from_slice(&[0x31; 32]).expect("valid dummy principal asset id")
}

pub fn offer_params(
    session: &Session,
    principal_asset_id: AssetId,
    loan_expiration_offset: u32,
) -> anyhow::Result<CreateOfferParams> {
    let current_height = session.signer().get_provider()?.fetch_tip_height()?;

    Ok(CreateOfferParams {
        principal_asset_id,
        protocol_fee_keeper_asset_id: AssetId::from_slice(&[0x41; 32])
            .expect("valid protocol fee keeper asset id"),
        offer_parameters: OfferParameters {
            collateral_amount: 3_000,
            principal_amount: TEST_PRINCIPAL_AMOUNT,
            loan_expiration_time: current_height + loan_expiration_offset,
            principal_interest_rate: 1_000,
        },
    })
}

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
        .get_provider()?
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

pub async fn accept_pending_offer(
    lender: &Session,
    pool: &PgPool,
    offer_id: i64,
    offer: &OfferCreation,
) -> anyhow::Result<(AcceptOfferTx, Txid)> {
    let accept = lender.accept_offer(&offer_id.to_string()).await?;

    let receipt = lender.signer().broadcast(&accept.transaction)?;
    let accept_txid = receipt.txid();
    receipt.wait()?;

    let block_height = 200_u64;
    let accept_txid_bytes = accept_txid.as_byte_array().to_vec();
    let pending_offer_outpoint =
        OutPoint::new(offer.creation_txid, offer.pending_offer_vout as u32);
    let old_lender_outpoint = OutPoint::new(offer.creation_txid, offer.lender_nft_vout as u32);

    let mut sql_tx = pool.begin().await?;

    spend_offer_utxo(
        &mut sql_tx,
        &pending_offer_outpoint,
        block_height,
        accept_txid,
    )
    .await?;
    update_offer_status(&mut sql_tx, offer_id, OfferStatus::Active, block_height).await?;

    insert_offer_utxo(
        &mut sql_tx,
        &OfferUtxoModel {
            offer_id,
            txid: accept_txid_bytes.clone(),
            vout: 0,
            utxo_type: UtxoType::ActiveOffer,
            created_at_height: block_height as i64,
            spent_txid: None,
            spent_at_height: None,
        },
    )
    .await?;

    insert_offer_utxo(
        &mut sql_tx,
        &OfferUtxoModel {
            offer_id,
            txid: accept_txid_bytes.clone(),
            vout: 1,
            utxo_type: UtxoType::BorrowerPrincipal,
            created_at_height: block_height as i64,
            spent_txid: None,
            spent_at_height: None,
        },
    )
    .await?;

    spend_participant_utxo(&mut sql_tx, &old_lender_outpoint, block_height, accept_txid).await?;

    insert_participant_utxo(
        &mut sql_tx,
        &OfferParticipantModel {
            offer_id,
            participant_type: ParticipantType::Lender,
            script_pubkey: lender.signer().get_address().script_pubkey().to_bytes(),
            txid: accept_txid_bytes,
            vout: 2,
            created_at_height: block_height as i64,
            spent_txid: None,
            spent_at_height: None,
        },
    )
    .await?;

    sql_tx.commit().await?;

    Ok((accept, accept_txid))
}

pub async fn repay_active_offer(
    borrower: &Session,
    pool: &PgPool,
    offer_id: i64,
    accept_txid: Txid,
    offer_parameters: &LendingOfferParameters,
) -> anyhow::Result<Txid> {
    let repay = borrower.repay_offer(&offer_id.to_string()).await?;

    let receipt = borrower.signer().broadcast(&repay)?;
    let repay_txid = receipt.txid();
    receipt.wait()?;

    let block_height = 300_u64;
    let active_offer_outpoint = OutPoint::new(accept_txid, 0);
    let total_to_repay = offer_parameters
        .offer_parameters
        .get_total_amount_to_repay();
    let protocol_fee = offer_parameters.offer_parameters.get_total_protocol_fee();
    let lender_vault_amount = total_to_repay - protocol_fee;

    // First full repayment: borrower NFT burn @0, lender vault @1, protocol vault @2.
    const LENDER_VAULT_VOUT: i32 = 1;
    const PROTOCOL_FEE_VAULT_VOUT: i32 = 2;

    let mut sql_tx = pool.begin().await?;

    spend_offer_utxo(
        &mut sql_tx,
        &active_offer_outpoint,
        block_height,
        repay_txid,
    )
    .await?;
    update_offer_status(&mut sql_tx, offer_id, OfferStatus::Repaid, block_height).await?;

    insert_offer_vault(
        &mut sql_tx,
        &OfferVaultModel {
            id: 0,
            offer_id,
            vault_type: VaultType::Lender,
            txid: repay_txid.as_byte_array().to_vec(),
            vout: LENDER_VAULT_VOUT,
            amount: lender_vault_amount as i64,
            already_supplied: 0,
            is_finalized: true,
            created_at_height: block_height as i64,
            updated_at_height: block_height as i64,
            spent_txid: None,
            spent_at_height: None,
        },
    )
    .await?;

    if protocol_fee > 0 {
        insert_offer_vault(
            &mut sql_tx,
            &OfferVaultModel {
                id: 0,
                offer_id,
                vault_type: VaultType::ProtocolFee,
                txid: repay_txid.as_byte_array().to_vec(),
                vout: PROTOCOL_FEE_VAULT_VOUT,
                amount: protocol_fee as i64,
                already_supplied: 0,
                is_finalized: true,
                created_at_height: block_height as i64,
                updated_at_height: block_height as i64,
                spent_txid: None,
                spent_at_height: None,
            },
        )
        .await?;
    }

    sql_tx.commit().await?;

    Ok(repay_txid)
}

pub async fn assert_offer_status(
    session: &Session,
    offer_id: i64,
    expected: OfferStatus,
) -> anyhow::Result<()> {
    let status = session
        .indexer()
        .get_offer(&offer_id.to_string())
        .await?
        .info
        .base
        .status;
    assert_eq!(status, expected);
    Ok(())
}

pub async fn claim_borrower_principal(
    borrower: &Session,
    pool: &PgPool,
    offer_id: i64,
    offer: &OfferCreation,
    accept_txid: Txid,
) -> anyhow::Result<Txid> {
    let claim = borrower.claim_principal(&offer_id.to_string()).await?;

    let receipt = borrower.signer().broadcast(&claim)?;
    let claim_txid = receipt.txid();
    receipt.wait()?;

    let block_height = 250_u64;
    let borrower_principal_outpoint = OutPoint::new(accept_txid, 1);
    let old_borrower_nft_outpoint =
        OutPoint::new(offer.creation_txid, offer.borrower_nft_vout as u32);

    let mut sql_tx = pool.begin().await?;

    spend_offer_utxo(
        &mut sql_tx,
        &borrower_principal_outpoint,
        block_height,
        claim_txid,
    )
    .await?;
    spend_participant_utxo(
        &mut sql_tx,
        &old_borrower_nft_outpoint,
        block_height,
        claim_txid,
    )
    .await?;

    insert_participant_utxo(
        &mut sql_tx,
        &OfferParticipantModel {
            offer_id,
            participant_type: ParticipantType::Borrower,
            script_pubkey: borrower.signer().get_address().script_pubkey().to_bytes(),
            txid: claim_txid.as_byte_array().to_vec(),
            vout: 0,
            created_at_height: block_height as i64,
            spent_txid: None,
            spent_at_height: None,
        },
    )
    .await?;

    sql_tx.commit().await?;

    Ok(claim_txid)
}

pub async fn claim_lender_vault(
    lender: &Session,
    pool: &PgPool,
    offer_id: i64,
    accept_txid: Txid,
    repay_txid: Txid,
) -> anyhow::Result<Txid> {
    let claim = lender.claim_lender_vault(&offer_id.to_string()).await?;

    let receipt = lender.signer().broadcast(&claim)?;
    let claim_txid = receipt.txid();
    receipt.wait()?;

    let block_height = 400_u64;
    let lender_vault_outpoint = OutPoint::new(repay_txid, 1);
    let lender_nft_outpoint = OutPoint::new(accept_txid, 2);

    let mut sql_tx = pool.begin().await?;

    spend_offer_utxo(
        &mut sql_tx,
        &lender_vault_outpoint,
        block_height,
        claim_txid,
    )
    .await?;
    update_offer_status(&mut sql_tx, offer_id, OfferStatus::Claimed, block_height).await?;
    spend_participant_utxo(&mut sql_tx, &lender_nft_outpoint, block_height, claim_txid).await?;

    sql_tx.commit().await?;

    Ok(claim_txid)
}

pub async fn cancel_pending_offer(
    borrower: &Session,
    pool: &PgPool,
    offer_id: i64,
    offer: &OfferCreation,
) -> anyhow::Result<Txid> {
    let cancel = borrower.cancel_offer(&offer_id.to_string()).await?;

    let receipt = borrower.signer().broadcast(&cancel)?;
    let cancel_txid = receipt.txid();
    receipt.wait()?;

    let block_height = 150_u64;
    let pending_offer_outpoint =
        OutPoint::new(offer.creation_txid, offer.pending_offer_vout as u32);
    let borrower_nft_outpoint = OutPoint::new(offer.creation_txid, offer.borrower_nft_vout as u32);
    let lender_nft_outpoint = OutPoint::new(offer.creation_txid, offer.lender_nft_vout as u32);

    let mut sql_tx = pool.begin().await?;

    spend_offer_utxo(
        &mut sql_tx,
        &pending_offer_outpoint,
        block_height,
        cancel_txid,
    )
    .await?;
    update_offer_status(&mut sql_tx, offer_id, OfferStatus::Cancelled, block_height).await?;
    spend_participant_utxo(
        &mut sql_tx,
        &borrower_nft_outpoint,
        block_height,
        cancel_txid,
    )
    .await?;
    spend_participant_utxo(&mut sql_tx, &lender_nft_outpoint, block_height, cancel_txid).await?;

    sql_tx.commit().await?;

    Ok(cancel_txid)
}

pub async fn liquidate_active_offer(
    lender: &Session,
    pool: &PgPool,
    offer_id: i64,
    accept_txid: Txid,
) -> anyhow::Result<Txid> {
    let liquidation = lender.liquidate_offer(&offer_id.to_string()).await?;

    let receipt = lender.signer().broadcast(&liquidation)?;
    let liquidation_txid = receipt.txid();
    receipt.wait()?;

    let block_height = 350_u64;
    let active_offer_outpoint = OutPoint::new(accept_txid, 0);
    let lender_nft_outpoint = OutPoint::new(accept_txid, 2);

    let mut sql_tx = pool.begin().await?;

    spend_offer_utxo(
        &mut sql_tx,
        &active_offer_outpoint,
        block_height,
        liquidation_txid,
    )
    .await?;
    update_offer_status(&mut sql_tx, offer_id, OfferStatus::Liquidated, block_height).await?;
    spend_participant_utxo(
        &mut sql_tx,
        &lender_nft_outpoint,
        block_height,
        liquidation_txid,
    )
    .await?;

    sql_tx.commit().await?;

    Ok(liquidation_txid)
}
