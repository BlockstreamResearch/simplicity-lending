#![allow(dead_code)]

use utoipa::ToSchema;

use uuid::Uuid;

use crate::api::offers::dto::{OfferUtxoDto, ParticipantDto};
use crate::models::OfferStatus;

/// Flat OpenAPI schema for `OfferDetailsResponse` (`#[serde(flatten)]` is not supported by utoipa).
#[derive(ToSchema)]
pub struct OfferDetailsResponseSchema {
    pub id: Uuid,
    pub issuance_factory_id: Uuid,
    pub status: OfferStatus,
    pub collateral_asset: String,
    pub principal_asset: String,
    /// Collateral amount in satoshis (decimal string).
    #[schema(example = "1000")]
    pub collateral_amount: String,
    /// Principal amount in satoshis (decimal string).
    #[schema(example = "500")]
    pub principal_amount: String,
    /// Interest rate in basis points.
    #[schema(example = 120)]
    pub interest_rate: u32,
    pub loan_expiration_height: u32,
    pub created_at_height: u64,
    pub created_at_txid: String,
    pub borrower_nft_asset: String,
    pub lender_nft_asset: String,
    pub protocol_fee_keeper_asset: String,
    pub participants: Vec<ParticipantDto>,
    pub utxos: Vec<OfferUtxoDto>,
}
