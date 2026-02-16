use simplicityhl::elements::hex::ToHex;
use uuid::Uuid;

use crate::{
    api::utils::format_hex,
    models::{OfferParticipantModel, ParticipantType},
};

#[derive(serde::Serialize)]
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

impl From<OfferParticipantModel> for ParticipantDto {
    fn from(value: OfferParticipantModel) -> Self {
        Self {
            offer_id: value.offer_id,
            participant_type: value.participant_type,
            script_pubkey: value.script_pubkey.to_hex(),
            txid: format_hex(value.txid),
            vout: value.vout as u32,
            created_at_height: value.created_at_height as u64,
            spent_txid: value.spent_txid.map(format_hex),
            spent_at_height: value.spent_at_height.map(|height| height as u64),
        }
    }
}

#[derive(serde::Deserialize)]
pub struct ScriptQuery {
    pub script_pubkey: String,
}
