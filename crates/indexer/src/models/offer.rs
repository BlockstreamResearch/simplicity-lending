use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, sqlx::Type)]
#[sqlx(type_name = "offer_status", rename_all = "lowercase")]
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
    pub borrower_pub_key: Vec<u8>,
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
