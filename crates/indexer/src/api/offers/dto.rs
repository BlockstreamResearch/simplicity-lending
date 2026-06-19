use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

use simplex::simplicityhl::elements::hex::ToHex;

use crate::api::utils::{format_hex, format_satoshis};
use crate::models::{
    OfferModel, OfferModelShort, OfferParticipantModel, OfferStatus, OfferUtxoModel,
    ParticipantType, UtxoType,
};

#[derive(Serialize, ToSchema)]
pub struct ParticipantShort {
    pub participant_type: ParticipantType,
    pub script_pubkey: String,
}

impl From<&OfferParticipantModel> for ParticipantShort {
    fn from(value: &OfferParticipantModel) -> Self {
        Self {
            participant_type: value.participant_type,
            script_pubkey: value.script_pubkey.to_hex(),
        }
    }
}

#[derive(Serialize, ToSchema)]
pub struct OfferUtxoOutpointShort {
    pub txid: String,
    pub vout: u32,
}

impl From<&OfferUtxoModel> for OfferUtxoOutpointShort {
    fn from(value: &OfferUtxoModel) -> Self {
        Self {
            txid: format_hex(value.txid.clone()),
            vout: value.vout as u32,
        }
    }
}

#[derive(Serialize, ToSchema)]
pub struct OfferListItemShort {
    pub id: Uuid,
    pub issuance_factory_id: Uuid,
    pub status: OfferStatus,
    pub collateral_asset: String,
    pub principal_asset: String,
    /// Collateral amount in satoshis (decimal string).
    #[schema(example = "1000")]
    pub collateral_amount: String,
    /// Principal amount in satoshis (decimal string).
    #[schema(example = "500")]
    pub principal_amount: String,
    /// Interest rate in basis points.
    #[schema(example = 120)]
    pub interest_rate: u32,
    pub loan_expiration_height: u32,
    pub created_at_height: u64,
    pub created_at_txid: String,
    pub participants: Vec<ParticipantShort>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub borrower_principal_utxo: Option<OfferUtxoOutpointShort>,
}

#[derive(Serialize, ToSchema)]
pub struct OfferListResponse {
    pub items: Vec<OfferListItemShort>,
    pub total: u64,
    pub limit: u64,
    pub offset: u64,
}

impl From<OfferModelShort> for OfferListItemShort {
    fn from(value: OfferModelShort) -> Self {
        Self {
            id: value.id,
            issuance_factory_id: value.issuance_factory_id,
            status: value.current_status,
            collateral_asset: format_hex(value.collateral_asset_id),
            principal_asset: format_hex(value.principal_asset_id),
            collateral_amount: format_satoshis(value.collateral_amount),
            principal_amount: format_satoshis(value.principal_amount),
            interest_rate: value.interest_rate as u32,
            loan_expiration_height: value.loan_expiration_time as u32,
            created_at_height: value.created_at_height as u64,
            created_at_txid: format_hex(value.created_at_txid),
            participants: Vec::new(),
            borrower_principal_utxo: None,
        }
    }
}

#[derive(Serialize)]
pub struct OfferListItemFull {
    #[serde(flatten)]
    pub base: OfferListItemShort,

    pub borrower_nft_asset: String,
    pub lender_nft_asset: String,
    pub protocol_fee_keeper_asset: String,
}

impl From<OfferModel> for OfferListItemFull {
    fn from(value: OfferModel) -> Self {
        Self {
            base: OfferListItemShort {
                id: value.id,
                issuance_factory_id: value.issuance_factory_id,
                status: value.current_status,
                collateral_asset: format_hex(value.collateral_asset_id),
                principal_asset: format_hex(value.principal_asset_id),
                collateral_amount: format_satoshis(value.collateral_amount),
                principal_amount: format_satoshis(value.principal_amount),
                interest_rate: value.interest_rate as u32,
                loan_expiration_height: value.loan_expiration_time as u32,
                created_at_height: value.created_at_height as u64,
                created_at_txid: format_hex(value.created_at_txid),
                participants: Vec::new(),
                borrower_principal_utxo: None,
            },
            borrower_nft_asset: format_hex(value.borrower_nft_asset_id),
            lender_nft_asset: format_hex(value.lender_nft_asset_id),
            protocol_fee_keeper_asset: format_hex(value.protocol_fee_keeper_asset_id),
        }
    }
}

#[derive(Serialize, ToSchema)]
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

#[derive(Serialize, ToSchema)]
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

#[derive(Serialize)]
pub struct OfferDetailsResponse {
    #[serde(flatten)]
    pub info: OfferListItemFull,
    pub participants: Vec<ParticipantDto>,
    pub utxos: Vec<OfferUtxoDto>,
}

#[cfg(test)]
mod tests {
    use super::{
        OfferListItemFull, OfferListItemShort, OfferUtxoDto, OfferUtxoOutpointShort,
        ParticipantDto, ParticipantShort,
    };
    use crate::models::{
        OfferModel, OfferModelShort, OfferParticipantModel, OfferStatus, OfferUtxoModel,
        ParticipantType, UtxoType,
    };
    use uuid::Uuid;

    #[test]
    fn offer_list_item_short_from_model_short_maps_and_formats_fields() {
        let id = Uuid::new_v4();
        let model = OfferModelShort {
            id,
            issuance_factory_id: Uuid::new_v4(),
            collateral_asset_id: vec![0x01, 0x02, 0x03],
            principal_asset_id: vec![0x04, 0x05, 0x06],
            collateral_amount: 1000,
            principal_amount: 500,
            interest_rate: 250,
            loan_expiration_time: 123,
            current_status: OfferStatus::Active,
            created_at_height: 456,
            created_at_txid: vec![0xaa, 0xbb, 0xcc],
        };

        let dto = OfferListItemShort::from(model);

        assert_eq!(dto.id, id);
        assert_eq!(dto.status, OfferStatus::Active);
        assert_eq!(dto.collateral_asset, "030201");
        assert_eq!(dto.principal_asset, "060504");
        assert_eq!(dto.collateral_amount, "1000");
        assert_eq!(dto.principal_amount, "500");
        assert_eq!(dto.interest_rate, 250);
        assert_eq!(dto.loan_expiration_height, 123);
        assert_eq!(dto.created_at_height, 456);
        assert_eq!(dto.created_at_txid, "ccbbaa");
        assert!(dto.participants.is_empty());
        assert!(dto.borrower_principal_utxo.is_none());
    }

    #[test]
    fn participant_short_from_model_maps_type_and_script() {
        let model = OfferParticipantModel {
            offer_id: Uuid::new_v4(),
            participant_type: ParticipantType::Borrower,
            script_pubkey: vec![0x52, 0xac],
            txid: vec![0x01],
            vout: 3,
            created_at_height: 1,
            spent_txid: None,
            spent_at_height: None,
        };

        let dto = ParticipantShort::from(&model);

        assert_eq!(dto.participant_type, ParticipantType::Borrower);
        assert_eq!(dto.script_pubkey, "52ac");
    }

    #[test]
    fn offer_utxo_outpoint_short_from_model_maps_txid_and_vout() {
        let model = OfferUtxoModel {
            offer_id: Uuid::new_v4(),
            txid: vec![0xab, 0xcd],
            vout: 1,
            utxo_type: UtxoType::BorrowerPrincipal,
            created_at_height: 2,
            spent_txid: None,
            spent_at_height: None,
        };

        let dto = OfferUtxoOutpointShort::from(&model);

        assert_eq!(dto.txid, "cdab");
        assert_eq!(dto.vout, 1);
    }

    #[test]
    fn offer_list_item_full_from_model_maps_nested_and_extra_fields() {
        let id = Uuid::new_v4();
        let model = OfferModel {
            id,
            issuance_factory_id: Uuid::new_v4(),
            collateral_asset_id: vec![0x01, 0x02],
            principal_asset_id: vec![0x03, 0x04],
            borrower_nft_asset_id: vec![0x09, 0x0a],
            lender_nft_asset_id: vec![0x0b, 0x0c],
            protocol_fee_keeper_asset_id: vec![0x0b, 0x2c],
            collateral_amount: 99,
            principal_amount: 77,
            interest_rate: 12,
            loan_expiration_time: 321,
            current_status: OfferStatus::Pending,
            created_at_height: 55,
            created_at_txid: vec![0xde, 0xad],
        };

        let dto = OfferListItemFull::from(model);

        assert_eq!(dto.base.id, id);
        assert_eq!(dto.base.status, OfferStatus::Pending);
        assert_eq!(dto.base.collateral_asset, "0201");
        assert_eq!(dto.base.principal_asset, "0403");
        assert_eq!(dto.base.created_at_txid, "adde");
        assert_eq!(dto.borrower_nft_asset, "0a09");
        assert_eq!(dto.lender_nft_asset, "0c0b");
        assert_eq!(dto.protocol_fee_keeper_asset, "2c0b");
    }

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
    fn offer_utxo_dto_from_model_handles_unspent_borrower_principal() {
        let model = OfferUtxoModel {
            offer_id: Uuid::new_v4(),
            txid: vec![0x22],
            vout: 1,
            utxo_type: UtxoType::BorrowerPrincipal,
            created_at_height: 2,
            spent_txid: None,
            spent_at_height: None,
        };

        let dto = OfferUtxoDto::from(model);

        assert_eq!(dto.vout, 1);
        assert_eq!(dto.utxo_type, UtxoType::BorrowerPrincipal);
        assert_eq!(dto.spent_txid, None);
        assert_eq!(dto.spent_at_height, None);
    }

    #[test]
    fn offer_utxo_dto_from_model_handles_unspent_utxo() {
        let model = OfferUtxoModel {
            offer_id: Uuid::new_v4(),
            txid: vec![0x11],
            vout: 0,
            utxo_type: UtxoType::ActiveOffer,
            created_at_height: 1,
            spent_txid: None,
            spent_at_height: None,
        };

        let dto = OfferUtxoDto::from(model);

        assert_eq!(dto.spent_txid, None);
        assert_eq!(dto.spent_at_height, None);
    }
}
