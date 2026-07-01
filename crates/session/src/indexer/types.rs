use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OfferStatus {
    Pending,
    Active,
    Repaid,
    Liquidated,
    Cancelled,
    Claimed,
}

impl OfferStatus {
    pub fn as_query_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Active => "active",
            Self::Repaid => "repaid",
            Self::Liquidated => "liquidated",
            Self::Cancelled => "cancelled",
            Self::Claimed => "claimed",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ParticipantType {
    Borrower,
    Lender,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UtxoType {
    PendingOffer,
    ActiveOffer,
    BorrowerPrincipal,
    Cancellation,
    Repayment,
    Liquidation,
    Claim,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FactoryStatus {
    Active,
    Removed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AssetAmount {
    pub asset: String,
    pub amount: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParticipantShort {
    pub participant_type: ParticipantType,
    pub script_pubkey: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OfferUtxoOutpointShort {
    pub txid: String,
    pub vout: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OfferListItemShort {
    pub id: Uuid,
    pub issuance_factory_id: Uuid,
    pub status: OfferStatus,
    pub collateral_asset: String,
    pub principal_asset: String,
    pub collateral_amount: String,
    pub principal_amount: String,
    pub interest_rate: u32,
    pub loan_expiration_height: u32,
    pub created_at_height: u64,
    pub created_at_txid: String,
    #[serde(default)]
    pub participants: Vec<ParticipantShort>,
    #[serde(default)]
    pub borrower_principal_utxo: Option<OfferUtxoOutpointShort>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OfferListResponse {
    pub items: Vec<OfferListItemShort>,
    pub total: u64,
    pub limit: u64,
    pub offset: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OfferListItemFull {
    #[serde(flatten)]
    pub base: OfferListItemShort,
    pub borrower_nft_asset: String,
    pub lender_nft_asset: String,
    pub protocol_fee_keeper_asset: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParticipantDto {
    pub offer_id: Uuid,
    pub participant_type: ParticipantType,
    pub script_pubkey: String,
    pub txid: String,
    pub vout: u32,
    pub created_at_height: u64,
    pub spent_txid: Option<String>,
    pub spent_at_height: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OfferUtxoDto {
    pub offer_id: Uuid,
    pub txid: String,
    pub vout: u32,
    pub utxo_type: UtxoType,
    pub created_at_height: u64,
    pub spent_txid: Option<String>,
    pub spent_at_height: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OfferDetailsResponse {
    #[serde(flatten)]
    pub info: OfferListItemFull,
    pub participants: Vec<ParticipantDto>,
    pub utxos: Vec<OfferUtxoDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OffersOverview {
    pub collateral_locked: Vec<AssetAmount>,
    pub active_loan_principal: Vec<AssetAmount>,
    pub active_loans_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BorrowerOverview {
    pub collateral_locked: Vec<AssetAmount>,
    pub borrowings: Vec<AssetAmount>,
    pub active_loans: u64,
    pub pending_offers: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LenderOverview {
    pub supplied_loans: Vec<AssetAmount>,
    pub interest_outstanding: Vec<AssetAmount>,
    pub active_loans: u64,
    pub to_be_claimed: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FactoryProgramUtxoDto {
    pub txid: String,
    pub vout: u32,
    pub created_at_height: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FactoryAuthUtxoDto {
    pub txid: String,
    pub vout: u32,
    pub script_pubkey: String,
    pub created_at_height: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FactoryDetailsResponse {
    pub id: Uuid,
    pub factory_asset_id: String,
    pub program_script_pubkey: String,
    pub status: FactoryStatus,
    pub issuing_utxos_count: u16,
    pub reissuance_flags: u64,
    pub created_at_height: u64,
    pub created_at_txid: String,
    pub auth_utxo: Option<FactoryAuthUtxoDto>,
    pub program_utxo: Option<FactoryProgramUtxoDto>,
}
