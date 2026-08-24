use serde::{Deserialize, Serialize};

#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    PartialOrd,
    Eq,
    sqlx::Type,
    Serialize,
    Deserialize,
    utoipa::ToSchema,
)]
#[sqlx(type_name = "utxo_type", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum UtxoType {
    PendingOffer,
    ActiveOffer,
    BorrowerPrincipal,
    Cancellation,
    Liquidation,
}

#[derive(Debug, sqlx::FromRow)]
pub struct OfferUtxoModel {
    pub offer_id: i64,
    pub txid: Vec<u8>,
    pub vout: i32,
    pub utxo_type: UtxoType,
    pub created_at_height: i64,
    pub spent_txid: Option<Vec<u8>>,
    pub spent_at_height: Option<i64>,
}
