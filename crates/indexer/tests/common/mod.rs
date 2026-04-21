#![allow(dead_code)]

use std::env;
use std::str::FromStr;

use lending_indexer::indexer::{
    insert_offer, insert_offer_utxo, insert_participant_utxo, update_offer_status,
};
use lending_indexer::models::{
    OfferModel, OfferParticipantModel, OfferStatus, OfferUtxoModel, ParticipantType, UtxoType,
};
use simplex::simplicityhl::elements::{
    AssetId, LockTime, OutPoint, Script, Transaction, TxIn, TxOut, Txid, confidential,
    hashes::Hash, secp256k1_zkp::XOnlyPublicKey,
};
use sqlx::PgPool;
use uuid::Uuid;

pub const FIXED_BORROWER_PUBKEY_HEX: &str =
    "7c7db0528e8b7b58e698ac104764f6852d74b5a7335bffcdad0ce799dd7742ec";

pub fn fixed_borrower_pubkey_bytes() -> Vec<u8> {
    XOnlyPublicKey::from_str(FIXED_BORROWER_PUBKEY_HEX)
        .expect("valid xonly key")
        .serialize()
        .to_vec()
}

/// Returns a ready-to-use pool with migrations applied and domain tables
/// truncated. Panics (instead of silent-skip) when `DATABASE_URL` is not
/// configured. Silent-skip would mask a completely empty test run in CI.
pub async fn test_pool() -> anyhow::Result<PgPool> {
    let database_url = env::var("DATABASE_URL").expect(
        "DATABASE_URL must be set for integration tests. \
         See crates/indexer/scripts/init_db.sh",
    );

    let pool = PgPool::connect(&database_url).await?;
    sqlx::migrate!("./migrations").run(&pool).await?;
    sqlx::query(
        r#"
        TRUNCATE TABLE
            offer_participants,
            offer_utxos,
            offers,
            sync_state
        RESTART IDENTITY CASCADE
        "#,
    )
    .execute(&pool)
    .await?;

    Ok(pool)
}

/// Produces a deterministic 32-byte blob unique per UUID. Handy for
/// `created_at_txid` (which has a UNIQUE constraint) when seeding several
/// offers in the same test.
pub fn unique_32_bytes_from_uuid(id: Uuid) -> Vec<u8> {
    let mut buf = [0_u8; 32];
    buf[..16].copy_from_slice(id.as_bytes());
    buf[16..].copy_from_slice(id.as_bytes());
    buf.to_vec()
}

pub fn offer_model(id: Uuid, created_at_height: i64, created_at_txid: Vec<u8>) -> OfferModel {
    OfferModel {
        id,
        borrower_pubkey: fixed_borrower_pubkey_bytes(),
        borrower_output_script_hash: vec![2; 32],
        collateral_asset_id: vec![3; 32],
        principal_asset_id: vec![4; 32],
        first_parameters_nft_asset_id: vec![5; 32],
        second_parameters_nft_asset_id: vec![6; 32],
        borrower_nft_asset_id: vec![7; 32],
        lender_nft_asset_id: vec![8; 32],
        collateral_amount: 1_000,
        principal_amount: 500,
        interest_rate: 120,
        loan_expiration_time: 1_234_567,
        current_status: OfferStatus::Pending,
        created_at_height,
        created_at_txid,
    }
}

pub async fn seed_offer_row(pool: &PgPool, offer: &OfferModel) -> anyhow::Result<()> {
    let mut sql_tx = pool.begin().await?;
    insert_offer(&mut sql_tx, offer).await?;
    if !matches!(offer.current_status, OfferStatus::Pending) {
        update_offer_status(&mut sql_tx, offer.id, offer.current_status).await?;
    }
    sql_tx.commit().await?;
    Ok(())
}

pub async fn seed_offer_utxo_row(pool: &PgPool, utxo: &OfferUtxoModel) -> anyhow::Result<()> {
    let mut sql_tx = pool.begin().await?;
    insert_offer_utxo(&mut sql_tx, utxo).await?;
    sql_tx.commit().await?;
    Ok(())
}

pub async fn seed_participant_utxo_row(
    pool: &PgPool,
    participant: &OfferParticipantModel,
) -> anyhow::Result<()> {
    let mut sql_tx = pool.begin().await?;
    insert_participant_utxo(&mut sql_tx, participant).await?;
    sql_tx.commit().await?;
    Ok(())
}

pub fn unspent_offer_utxo(
    offer_id: Uuid,
    outpoint: OutPoint,
    utxo_type: UtxoType,
    created_at_height: i64,
) -> OfferUtxoModel {
    OfferUtxoModel {
        offer_id,
        txid: outpoint.txid.as_byte_array().to_vec(),
        vout: outpoint.vout as i32,
        utxo_type,
        created_at_height,
        spent_txid: None,
        spent_at_height: None,
    }
}

pub fn spent_offer_utxo(
    offer_id: Uuid,
    outpoint: OutPoint,
    utxo_type: UtxoType,
    created_at_height: i64,
    spent_at_height: i64,
    spent_txid_byte: u8,
) -> OfferUtxoModel {
    OfferUtxoModel {
        offer_id,
        txid: outpoint.txid.as_byte_array().to_vec(),
        vout: outpoint.vout as i32,
        utxo_type,
        created_at_height,
        spent_txid: Some(vec![spent_txid_byte; 32]),
        spent_at_height: Some(spent_at_height),
    }
}

pub fn unspent_participant(
    offer_id: Uuid,
    participant_type: ParticipantType,
    outpoint: OutPoint,
    script_pubkey: Vec<u8>,
    created_at_height: i64,
) -> OfferParticipantModel {
    OfferParticipantModel {
        offer_id,
        participant_type,
        script_pubkey,
        txid: outpoint.txid.as_byte_array().to_vec(),
        vout: outpoint.vout as i32,
        created_at_height,
        spent_txid: None,
        spent_at_height: None,
    }
}

pub fn spent_participant(
    offer_id: Uuid,
    participant_type: ParticipantType,
    outpoint: OutPoint,
    script_pubkey: Vec<u8>,
    created_at_height: i64,
    spent_at_height: i64,
    spent_txid_byte: u8,
) -> OfferParticipantModel {
    OfferParticipantModel {
        offer_id,
        participant_type,
        script_pubkey,
        txid: outpoint.txid.as_byte_array().to_vec(),
        vout: outpoint.vout as i32,
        created_at_height,
        spent_txid: Some(vec![spent_txid_byte; 32]),
        spent_at_height: Some(spent_at_height),
    }
}

pub fn outpoint_with_txid_byte(txid_byte: u8, vout: u32) -> OutPoint {
    OutPoint {
        txid: Txid::from_slice(&[txid_byte; 32]).expect("valid txid bytes"),
        vout,
    }
}

pub fn outpoint_from_uuid_vout(id: Uuid, vout: u32) -> OutPoint {
    let mut txid_bytes = [0_u8; 32];
    txid_bytes[..16].copy_from_slice(id.as_bytes());
    txid_bytes[16..].copy_from_slice(id.as_bytes());
    // Perturb first byte so UTXO txid differs from offer's created_at_txid.
    txid_bytes[0] ^= 0x5a;
    OutPoint {
        txid: Txid::from_slice(&txid_bytes).expect("valid txid bytes"),
        vout,
    }
}

pub fn normal_output() -> TxOut {
    TxOut::default()
}

pub fn null_data_output() -> TxOut {
    TxOut {
        script_pubkey: Script::new_op_return(b"burn"),
        ..Default::default()
    }
}

/// Concrete non-empty, non-OP_RETURN script. `Script::default()` is empty
/// and looks like a malformed output in participant-movement assertions.
pub fn non_op_return_script() -> Script {
    Script::from(vec![0x51_u8]) // OP_1
}

pub fn tx_with_input(spent: OutPoint, outputs: Vec<TxOut>) -> Transaction {
    Transaction {
        version: 2,
        lock_time: LockTime::ZERO,
        input: vec![TxIn {
            previous_output: spent,
            ..Default::default()
        }],
        output: outputs,
    }
}

pub fn tx_with_inputs(spent: Vec<OutPoint>, outputs: Vec<TxOut>) -> Transaction {
    Transaction {
        version: 2,
        lock_time: LockTime::ZERO,
        input: spent
            .into_iter()
            .map(|previous_output| TxIn {
                previous_output,
                ..Default::default()
            })
            .collect(),
        output: outputs,
    }
}

pub fn padded_tx_with_inputs(known_inputs: Vec<OutPoint>, outputs: Vec<TxOut>) -> Transaction {
    let mut inputs = known_inputs;
    let mut vout_counter = 1_000_u32;
    while inputs.len() < 7 {
        inputs.push(outpoint_with_txid_byte(0xff, vout_counter));
        vout_counter += 1;
    }
    tx_with_inputs(inputs, outputs)
}

pub fn explicit_asset_output(asset_byte: u8, script_pubkey: Script) -> TxOut {
    let mut output = TxOut {
        script_pubkey,
        ..Default::default()
    };
    let asset_id = AssetId::from_slice(&[asset_byte; 32]).expect("valid asset id");
    output.asset = confidential::Asset::Explicit(asset_id);
    output
}
