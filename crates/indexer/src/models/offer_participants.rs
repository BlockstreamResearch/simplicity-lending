use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Eq, sqlx::Type, Serialize, Deserialize)]
#[sqlx(type_name = "participant_type", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum ParticipantType {
    Borrower,
    Lender,
}

#[derive(Debug, sqlx::FromRow)]
pub struct OfferParticipantModel {
    pub offer_id: Uuid,
    pub participant_type: ParticipantType,
    pub script_pubkey: Vec<u8>,
    pub txid: Vec<u8>,
    pub vout: i32,
    pub created_at_height: i64,
    pub spent_txid: Option<Vec<u8>>,
    pub spent_at_height: Option<i64>,
}
