#![allow(dead_code)]

use anyhow::Context;
use lending_contracts::programs::lending::{LendingOffer, LendingOfferParameters};
use lending_contracts::programs::program::SimplexProgram;
use lending_contracts::programs::script_auth::ScriptAuth;
use lending_indexer::indexer::{
    insert_offer, insert_offer_utxo, insert_offer_vault, insert_participant_utxo, spend_offer_utxo,
    spend_offer_vault, spend_participant_utxo, update_offer_debt_and_collateral,
    update_offer_status,
};
use lending_indexer::models::{
    OfferModel, OfferParticipantModel, OfferStatus, OfferUtxoModel, OfferVaultModel,
    ParticipantType, UtxoType, VaultType,
};
use lending_session::{
    AcceptOfferTx, CreateOfferParams, OfferParameters, Session, select_utxos_for_amount,
};
use simplex::simplicityhl::elements::{AssetId, OutPoint, Txid};
use simplex::transaction::{FinalTransaction, NativeSignature, PartialInput, PartialOutput};
use sqlx::PgPool;
use uuid::Uuid;

use super::factory::{
    IndexedFactoryState, create_active_factory, sync_factory_after_offer_creation,
};

pub const TEST_PRINCIPAL_AMOUNT: u64 = 10_000;
pub const DEFAULT_LOAN_EXPIRATION_OFFSET: u32 = 60;

pub fn dummy_principal_asset_id() -> AssetId {
    AssetId::from_byte_array([0x31; 32])
}

pub fn offer_params(
    session: &Session,
    principal_asset_id: AssetId,
    loan_expiration_offset: u32,
) -> anyhow::Result<CreateOfferParams> {
    let current_height = session.signer().get_provider()?.fetch_tip_height()?;

    Ok(CreateOfferParams {
        principal_asset_id,
        protocol_fee_keeper_asset_id: AssetId::from_byte_array([0x41; 32]),
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
) -> anyhow::Result<(i64, OfferCreation)> {
    let factory = create_active_factory(session, pool).await?;
    let offer_creation = create_and_broadcast_offer(session, params).await?;
    let offer_id = seed_pending_offer(pool, factory.id, &offer_creation).await?;

    Ok((offer_id, offer_creation))
}

pub async fn setup_pending_offer_with_existing_factory(
    borrower: &Session,
    pool: &PgPool,
    factory: &mut IndexedFactoryState,
    principal_asset_id: AssetId,
    loan_expiration_offset: u32,
) -> anyhow::Result<(i64, OfferCreation)> {
    let offer_creation = create_and_broadcast_offer(
        borrower,
        offer_params(borrower, principal_asset_id, loan_expiration_offset)?,
    )
    .await?;
    sync_factory_after_offer_creation(borrower, pool, factory, offer_creation.creation_txid)
        .await?;
    let offer_id = seed_pending_offer(pool, factory.id, &offer_creation).await?;
    Ok((offer_id, offer_creation))
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

/// Height the test helpers index repayments at.
const REPAYMENT_INDEX_HEIGHT: u64 = 300;

/// What a repayment left of the offer.
enum RepaymentOutcome {
    Full,
    Partial {
        continuing_offer_vout: i32,
        current_debt: u64,
        remaining_collateral: u64,
    },
}

struct RepaymentVault {
    vault_type: VaultType,
    vout: i32,
    amount: u64,
    already_supplied: u64,
    is_finalized: bool,
}

/// Indexes a broadcast repayment of the active offer created by `accept_txid`.
async fn index_repayment(
    pool: &PgPool,
    offer_id: i64,
    accept_txid: Txid,
    repay_txid: Txid,
    outcome: RepaymentOutcome,
    vaults: &[RepaymentVault],
) -> anyhow::Result<()> {
    let block_height = REPAYMENT_INDEX_HEIGHT;
    let repay_txid_bytes = repay_txid.as_byte_array().to_vec();

    let mut sql_tx = pool.begin().await?;

    spend_offer_utxo(
        &mut sql_tx,
        &OutPoint::new(accept_txid, 0),
        block_height,
        repay_txid,
    )
    .await?;

    match outcome {
        RepaymentOutcome::Full => {
            update_offer_status(&mut sql_tx, offer_id, OfferStatus::Repaid, block_height).await?;
        }
        RepaymentOutcome::Partial {
            continuing_offer_vout,
            current_debt,
            remaining_collateral,
        } => {
            update_offer_debt_and_collateral(
                &mut sql_tx,
                offer_id,
                current_debt as i64,
                remaining_collateral as i64,
                block_height,
            )
            .await?;
            insert_offer_utxo(
                &mut sql_tx,
                &OfferUtxoModel {
                    offer_id,
                    txid: repay_txid_bytes.clone(),
                    vout: continuing_offer_vout,
                    utxo_type: UtxoType::ActiveOffer,
                    created_at_height: block_height as i64,
                    spent_txid: None,
                    spent_at_height: None,
                },
            )
            .await?;
        }
    }

    for vault in vaults {
        insert_offer_vault(
            &mut sql_tx,
            &OfferVaultModel {
                id: 0,
                offer_id,
                vault_type: vault.vault_type,
                txid: repay_txid_bytes.clone(),
                vout: vault.vout,
                amount: vault.amount as i64,
                already_supplied: vault.already_supplied as i64,
                is_finalized: vault.is_finalized,
                created_at_height: block_height as i64,
                updated_at_height: block_height as i64,
                spent_txid: None,
                spent_at_height: None,
            },
        )
        .await?;
    }

    sql_tx.commit().await?;

    Ok(())
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

    let total_to_repay = offer_parameters
        .offer_parameters
        .get_total_amount_to_repay();
    let protocol_fee = offer_parameters.offer_parameters.get_total_protocol_fee();

    // First full repayment: borrower NFT burn @0, lender vault @1, protocol vault @2.
    let finalized_vault = |vault_type, vout, amount| RepaymentVault {
        vault_type,
        vout,
        amount,
        already_supplied: 0,
        is_finalized: true,
    };
    let mut vaults = vec![finalized_vault(
        VaultType::Lender,
        1,
        total_to_repay - protocol_fee,
    )];
    if protocol_fee > 0 {
        vaults.push(finalized_vault(VaultType::ProtocolFee, 2, protocol_fee));
    }

    index_repayment(
        pool,
        offer_id,
        accept_txid,
        repay_txid,
        RepaymentOutcome::Full,
        &vaults,
    )
    .await?;

    Ok(repay_txid)
}

pub struct PartialRepayment {
    pub remaining_collateral: u64,
    pub lender_vault_amount: u64,
}

/// Repays `amount_to_repay` of a never repaid offer. The session only builds full repayments, so
/// the transaction is assembled here.
pub async fn partially_repay_active_offer(
    borrower: &Session,
    pool: &PgPool,
    offer_id: i64,
    accept_txid: Txid,
    parameters: &LendingOfferParameters,
    amount_to_repay: u64,
) -> anyhow::Result<PartialRepayment> {
    // Partial repayment layout: borrower NFT @0, continuing offer @1.
    const CONTINUING_OFFER_VOUT: i32 = 1;

    let signer = borrower.signer();
    let provider = signer.get_provider()?;
    let terms = parameters.offer_parameters;

    let mut active_offer = LendingOffer::new_active(*parameters, terms.get_total_amount_to_repay());

    let active_offer_utxo = provider
        .fetch_scripthash_utxos(&active_offer.get_script_pubkey())?
        .into_iter()
        .next()
        .context("active offer UTXO not found")?;
    let borrower_nft_utxo = signer
        .get_utxos_asset(parameters.borrower_nft_asset_id)?
        .into_iter()
        .next()
        .context("borrower NFT UTXO not found")?;
    let principal_utxos = select_utxos_for_amount(
        signer.get_utxos_asset(parameters.principal_asset_id)?,
        parameters.principal_asset_id,
        amount_to_repay,
    )
    .context("not enough principal to repay")?;

    let mut transaction = FinalTransaction::new();

    transaction.add_input(
        PartialInput::new(borrower_nft_utxo),
        Some(NativeSignature::Ecdsa),
    );
    transaction.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        1,
        parameters.borrower_nft_asset_id,
    ));

    active_offer.attach_partial_repayment(
        &mut transaction,
        active_offer_utxo,
        None,
        None,
        amount_to_repay,
    );

    for principal_utxo in principal_utxos.utxos() {
        transaction.add_input(
            PartialInput::new(principal_utxo.clone()),
            Some(NativeSignature::Ecdsa),
        );
    }

    let debt_after = active_offer.get_current_debt();
    let unlocked_collateral = terms.get_already_unlocked_collateral(debt_after);

    transaction.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        unlocked_collateral,
        parameters.collateral_asset_id,
    ));

    if principal_utxos.has_change() {
        let change_output = PartialOutput::new(
            signer.get_address().script_pubkey(),
            principal_utxos.change_amount(),
            parameters.principal_asset_id,
        );

        let change_output = if principal_utxos.any_confidential() {
            change_output.with_blinding_key(signer.get_blinding_public_key())
        } else {
            change_output
        };

        transaction.add_output(change_output);
    }

    let vaults = [
        (VaultType::Lender, parameters.get_lender_vault(debt_after)),
        (
            VaultType::ProtocolFee,
            parameters.get_protocol_fee_vault(debt_after),
        ),
    ]
    .into_iter()
    .map(|(vault_type, vault)| {
        let script_pubkey = vault.get_script_pubkey();
        let vout = transaction
            .outputs()
            .iter()
            .position(|output| output.script_pubkey == script_pubkey)
            .context("vault output not found")?;

        Ok(RepaymentVault {
            vault_type,
            vout: vout as i32,
            amount: transaction.outputs()[vout].amount,
            already_supplied: vault.get_already_supplied_amount(),
            is_finalized: false,
        })
    })
    .collect::<anyhow::Result<Vec<_>>>()?;

    let receipt = signer.broadcast(&transaction)?;
    let repay_txid = receipt.txid();
    receipt.wait()?;

    let remaining_collateral = terms.collateral_amount - unlocked_collateral;

    index_repayment(
        pool,
        offer_id,
        accept_txid,
        repay_txid,
        RepaymentOutcome::Partial {
            continuing_offer_vout: CONTINUING_OFFER_VOUT,
            current_debt: debt_after,
            remaining_collateral,
        },
        &vaults,
    )
    .await?;

    Ok(PartialRepayment {
        remaining_collateral,
        lender_vault_amount: vaults[0].amount,
    })
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

    spend_offer_vault(
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
