use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, Copy, PartialEq, Eq, sqlx::Type, Serialize, Deserialize, ToSchema)]
#[sqlx(type_name = "vault_type", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum VaultType {
    Lender,
    ProtocolFee,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct OfferVaultModel {
    pub id: i64,
    pub offer_id: i64,
    pub vault_type: VaultType,
    pub txid: Vec<u8>,
    pub vout: i32,
    pub amount: i64,
    pub already_supplied: i64,
    pub is_finalized: bool,
    pub created_at_height: i64,
    pub updated_at_height: i64,
    pub spent_txid: Option<Vec<u8>>,
    pub spent_at_height: Option<i64>,
}
