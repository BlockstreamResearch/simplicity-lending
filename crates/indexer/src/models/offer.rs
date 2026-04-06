use serde::{Deserialize, Serialize};
use uuid::Uuid;

use simplex::simplicityhl::elements::{Txid, hashes::Hash};

use lending_contracts::programs::PreLockParameters;

use crate::models::{ParticipantType, UtxoType};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UtxoData {
    Offer(UtxoType),
    Participant(ParticipantType),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ActiveUtxo {
    pub offer_id: Uuid,
    pub data: UtxoData,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, sqlx::Type, Serialize, Deserialize)]
#[sqlx(type_name = "offer_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum OfferStatus {
    Pending,
    Active,
    Repaid,
    Liquidated,
    Cancelled,
    Claimed,
}

#[derive(Debug, sqlx::FromRow)]
pub struct OfferModel {
    pub id: Uuid,
    pub borrower_pubkey: Vec<u8>,
    pub borrower_output_script_hash: Vec<u8>,
    pub collateral_asset_id: Vec<u8>,
    pub principal_asset_id: Vec<u8>,
    pub first_parameters_nft_asset_id: Vec<u8>,
    pub second_parameters_nft_asset_id: Vec<u8>,
    pub borrower_nft_asset_id: Vec<u8>,
    pub lender_nft_asset_id: Vec<u8>,
    pub collateral_amount: i64,
    pub principal_amount: i64,
    pub interest_rate: i32,
    pub loan_expiration_time: i32,
    pub current_status: OfferStatus,
    pub created_at_height: i64,
    pub created_at_txid: Vec<u8>,
}

impl OfferModel {
    pub fn new(pre_lock_parameters: &PreLockParameters, block_height: u64, txid: Txid) -> Self {
        Self {
            id: Uuid::new_v4(),
            borrower_pubkey: pre_lock_parameters.borrower_pubkey.serialize().to_vec(),
            borrower_output_script_hash: pre_lock_parameters.borrower_output_script_hash.to_vec(),
            collateral_asset_id: pre_lock_parameters
                .collateral_asset_id
                .into_inner()
                .0
                .to_vec(),
            principal_asset_id: pre_lock_parameters
                .principal_asset_id
                .into_inner()
                .0
                .to_vec(),
            first_parameters_nft_asset_id: pre_lock_parameters
                .first_parameters_nft_asset_id
                .into_inner()
                .0
                .to_vec(),
            second_parameters_nft_asset_id: pre_lock_parameters
                .second_parameters_nft_asset_id
                .into_inner()
                .0
                .to_vec(),
            borrower_nft_asset_id: pre_lock_parameters
                .borrower_nft_asset_id
                .into_inner()
                .0
                .to_vec(),
            lender_nft_asset_id: pre_lock_parameters
                .lender_nft_asset_id
                .into_inner()
                .0
                .to_vec(),
            collateral_amount: pre_lock_parameters.offer_parameters.collateral_amount as i64,
            principal_amount: pre_lock_parameters.offer_parameters.principal_amount as i64,
            interest_rate: pre_lock_parameters.offer_parameters.principal_interest_rate as i32,
            loan_expiration_time: pre_lock_parameters.offer_parameters.loan_expiration_time as i32,
            current_status: OfferStatus::Pending,
            created_at_height: block_height as i64,
            created_at_txid: txid.as_byte_array().to_vec(),
        }
    }
}

#[derive(Debug, sqlx::FromRow)]
pub struct OfferModelShort {
    pub id: Uuid,
    pub collateral_asset_id: Vec<u8>,
    pub principal_asset_id: Vec<u8>,
    pub collateral_amount: i64,
    pub principal_amount: i64,
    pub interest_rate: i32,
    pub loan_expiration_time: i32,
    pub current_status: OfferStatus,
    pub created_at_height: i64,
    pub created_at_txid: Vec<u8>,
}
