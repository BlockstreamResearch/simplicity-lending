use serde::Serialize;
use simplicityhl::elements::hex::ToHex;
use uuid::Uuid;

use crate::api::dto::ParticipantDto;
use crate::api::utils::format_hex;
use crate::models::{OfferModel, OfferModelShort, OfferStatus};

#[derive(Serialize)]
pub struct OfferListItemShort {
    pub id: Uuid,
    pub status: OfferStatus,
    pub collateral_asset: String,
    pub principal_asset: String,
    pub collateral_amount: u64,
    pub principal_amount: u64,
    pub interest_rate: u32,
    pub loan_expiration_time: u32,
    pub created_at_height: u64,
    pub created_at_txid: String,
}

impl From<OfferModelShort> for OfferListItemShort {
    fn from(value: OfferModelShort) -> Self {
        Self {
            id: value.id,
            status: value.current_status,
            collateral_asset: format_hex(value.collateral_asset_id),
            principal_asset: format_hex(value.principal_asset_id),
            collateral_amount: value.collateral_amount as u64,
            principal_amount: value.principal_amount as u64,
            interest_rate: value.interest_rate as u32,
            loan_expiration_time: value.loan_expiration_time as u32,
            created_at_height: value.created_at_height as u64,
            created_at_txid: format_hex(value.created_at_txid),
        }
    }
}

#[derive(Serialize)]
pub struct OfferListItemFull {
    #[serde(flatten)]
    pub base: OfferListItemShort,

    pub borrower_pubkey: String,
    pub first_parameters_nft_asset: String,
    pub second_parameters_nft_asset: String,
    pub borrower_nft_asset: String,
    pub lender_nft_asset: String,
}

impl From<OfferModel> for OfferListItemFull {
    fn from(value: OfferModel) -> Self {
        Self {
            base: OfferListItemShort {
                id: value.id,
                status: value.current_status,
                collateral_asset: format_hex(value.collateral_asset_id),
                principal_asset: format_hex(value.principal_asset_id),
                collateral_amount: value.collateral_amount as u64,
                principal_amount: value.principal_amount as u64,
                interest_rate: value.interest_rate as u32,
                loan_expiration_time: value.loan_expiration_time as u32,
                created_at_height: value.created_at_height as u64,
                created_at_txid: format_hex(value.created_at_txid),
            },
            borrower_pubkey: value.borrower_pubkey.to_hex(),
            first_parameters_nft_asset: format_hex(value.first_parameters_nft_asset_id),
            second_parameters_nft_asset: format_hex(value.second_parameters_nft_asset_id),
            borrower_nft_asset: format_hex(value.borrower_nft_asset_id),
            lender_nft_asset: format_hex(value.lender_nft_asset_id),
        }
    }
}

#[derive(serde::Deserialize, Debug)]
pub struct BatchIdsRequest {
    pub ids: Vec<Uuid>,
}

#[derive(Serialize)]
pub struct OfferDetailsResponse {
    #[serde(flatten)]
    pub info: OfferListItemFull,
    pub participants: Vec<ParticipantDto>,
}
