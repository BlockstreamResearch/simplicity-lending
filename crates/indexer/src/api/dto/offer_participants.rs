use uuid::Uuid;

use simplex::simplicityhl::elements::hex::ToHex;

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

#[cfg(test)]
mod tests {
    use super::ParticipantDto;
    use crate::models::{OfferParticipantModel, ParticipantType};
    use uuid::Uuid;

    #[test]
    fn participant_dto_from_model_maps_hex_and_spent_fields() {
        let offer_id = Uuid::new_v4();
        let model = OfferParticipantModel {
            offer_id,
            participant_type: ParticipantType::Borrower,
            script_pubkey: vec![0x51, 0xac],
            txid: vec![0x01, 0x02, 0x03],
            vout: 4,
            created_at_height: 500,
            spent_txid: Some(vec![0xaa, 0xbb]),
            spent_at_height: Some(777),
        };

        let dto = ParticipantDto::from(model);

        assert_eq!(dto.offer_id, offer_id);
        assert_eq!(dto.participant_type, ParticipantType::Borrower);
        assert_eq!(dto.script_pubkey, "51ac");
        assert_eq!(dto.txid, "030201");
        assert_eq!(dto.vout, 4);
        assert_eq!(dto.created_at_height, 500);
        assert_eq!(dto.spent_txid, Some("bbaa".to_string()));
        assert_eq!(dto.spent_at_height, Some(777));
    }

    #[test]
    fn participant_dto_from_model_handles_unspent_participant_utxo() {
        let model = OfferParticipantModel {
            offer_id: Uuid::new_v4(),
            participant_type: ParticipantType::Lender,
            script_pubkey: vec![0x00],
            txid: vec![0x10],
            vout: 0,
            created_at_height: 1,
            spent_txid: None,
            spent_at_height: None,
        };

        let dto = ParticipantDto::from(model);

        assert_eq!(dto.spent_txid, None);
        assert_eq!(dto.spent_at_height, None);
    }
}
