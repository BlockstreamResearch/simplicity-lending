use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Eq, sqlx::Type, Serialize, Deserialize)]
#[sqlx(type_name = "utxo_type", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum UtxoType {
    PreLock,
    Lending,
    Cancellation,
    Repayment,
    Liquidation,
    Claim,
}

#[derive(Debug, sqlx::FromRow)]
pub struct OfferUtxoModel {
    pub offer_id: Uuid,
    pub txid: Vec<u8>,
    pub vout: i32,
    pub utxo_type: UtxoType,
    pub created_at_height: i64,
    pub spent_txid: Option<Vec<u8>>,
    pub spent_at_height: Option<i64>,
}
