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

#[cfg(test)]
mod tests {
    use super::OfferUtxoDto;
    use crate::models::{OfferUtxoModel, UtxoType};
    use uuid::Uuid;

    #[test]
    fn offer_utxo_dto_from_model_maps_optional_spent_fields() {
        let offer_id = Uuid::new_v4();
        let model = OfferUtxoModel {
            offer_id,
            txid: vec![0x01, 0x02, 0x03],
            vout: 7,
            utxo_type: UtxoType::Repayment,
            created_at_height: 123,
            spent_txid: Some(vec![0xaa, 0xbb]),
            spent_at_height: Some(456),
        };

        let dto = OfferUtxoDto::from(model);

        assert_eq!(dto.offer_id, offer_id);
        assert_eq!(dto.txid, "030201");
        assert_eq!(dto.vout, 7);
        assert_eq!(dto.utxo_type, UtxoType::Repayment);
        assert_eq!(dto.created_at_height, 123);
        assert_eq!(dto.spent_txid, Some("bbaa".to_string()));
        assert_eq!(dto.spent_at_height, Some(456));
    }

    #[test]
    fn offer_utxo_dto_from_model_handles_unspent_utxo() {
        let model = OfferUtxoModel {
            offer_id: Uuid::new_v4(),
            txid: vec![0x11],
            vout: 0,
            utxo_type: UtxoType::Lending,
            created_at_height: 1,
            spent_txid: None,
            spent_at_height: None,
        };

        let dto = OfferUtxoDto::from(model);

        assert_eq!(dto.spent_txid, None);
        assert_eq!(dto.spent_at_height, None);
    }
}
