use serde::Serialize;
use uuid::Uuid;

use crate::{
    api::utils::format_hex,
    models::{OfferUtxoModel, UtxoType},
};

#[derive(Serialize)]
pub struct OfferUtxoDto {
    pub offer_id: Uuid,
    pub txid: String,
    pub vout: u32,
    pub utxo_type: UtxoType,
    pub created_at_height: u64,
    pub spent_txid: Option<String>,
    pub spent_at_height: Option<u64>,
}

impl From<OfferUtxoModel> for OfferUtxoDto {
    fn from(value: OfferUtxoModel) -> Self {
        Self {
            offer_id: value.offer_id,
            txid: format_hex(value.txid),
            vout: value.vout as u32,
            utxo_type: value.utxo_type,
            created_at_height: value.created_at_height as u64,
            spent_txid: value.spent_txid.map(format_hex),
            spent_at_height: value.spent_at_height.map(|height| height as u64),
        }
    }
}
