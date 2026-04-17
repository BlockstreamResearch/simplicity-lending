use serde::Serialize;
use simplex::simplicityhl::elements::hex::ToHex;
use uuid::Uuid;

use crate::api::dto::ParticipantDto;
use crate::api::utils::format_hex;
use crate::models::{OfferModel, OfferModelShort, OfferStatus};

#[derive(Serialize)]
pub struct OfferListItemShort {
    pub id: Uuid,
    pub status: OfferStatus,
    pub collateral_asset: String,
    pub principal_asset: String,
    pub collateral_amount: u64,
    pub principal_amount: u64,
    pub interest_rate: u32,
    pub loan_expiration_time: u32,
    pub created_at_height: u64,
    pub created_at_txid: String,
}

impl From<OfferModelShort> for OfferListItemShort {
    fn from(value: OfferModelShort) -> Self {
        Self {
            id: value.id,
            status: value.current_status,
            collateral_asset: format_hex(value.collateral_asset_id),
            principal_asset: format_hex(value.principal_asset_id),
            collateral_amount: value.collateral_amount as u64,
            principal_amount: value.principal_amount as u64,
            interest_rate: value.interest_rate as u32,
            loan_expiration_time: value.loan_expiration_time as u32,
            created_at_height: value.created_at_height as u64,
            created_at_txid: format_hex(value.created_at_txid),
        }
    }
}

#[derive(Serialize)]
pub struct OfferListItemFull {
    #[serde(flatten)]
    pub base: OfferListItemShort,

    pub borrower_pubkey: String,
    pub borrower_output_script_hash: String,
    pub first_parameters_nft_asset: String,
    pub second_parameters_nft_asset: String,
    pub borrower_nft_asset: String,
    pub lender_nft_asset: String,
}

impl From<OfferModel> for OfferListItemFull {
    fn from(value: OfferModel) -> Self {
        Self {
            base: OfferListItemShort {
                id: value.id,
                status: value.current_status,
                collateral_asset: format_hex(value.collateral_asset_id),
                principal_asset: format_hex(value.principal_asset_id),
                collateral_amount: value.collateral_amount as u64,
                principal_amount: value.principal_amount as u64,
                interest_rate: value.interest_rate as u32,
                loan_expiration_time: value.loan_expiration_time as u32,
                created_at_height: value.created_at_height as u64,
                created_at_txid: format_hex(value.created_at_txid),
            },
            borrower_pubkey: value.borrower_pubkey.to_hex(),
            borrower_output_script_hash: value.borrower_output_script_hash.to_hex(),
            first_parameters_nft_asset: format_hex(value.first_parameters_nft_asset_id),
            second_parameters_nft_asset: format_hex(value.second_parameters_nft_asset_id),
            borrower_nft_asset: format_hex(value.borrower_nft_asset_id),
            lender_nft_asset: format_hex(value.lender_nft_asset_id),
        }
    }
}

#[derive(serde::Deserialize, Debug)]
pub struct BatchIdsRequest {
    pub ids: Vec<Uuid>,
}

#[derive(serde::Deserialize, Debug)]
pub struct PendingOffersQuery {
    pub borrower_pubkey: String,
}

#[derive(Serialize)]
pub struct OfferDetailsResponse {
    #[serde(flatten)]
    pub info: OfferListItemFull,
    pub participants: Vec<ParticipantDto>,
}

#[cfg(test)]
mod tests {
    use super::{OfferListItemFull, OfferListItemShort};
    use crate::models::{OfferModel, OfferModelShort, OfferStatus};
    use uuid::Uuid;

    #[test]
    fn offer_list_item_short_from_model_short_maps_and_formats_fields() {
        let id = Uuid::new_v4();
        let model = OfferModelShort {
            id,
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
        assert_eq!(dto.collateral_amount, 1000);
        assert_eq!(dto.principal_amount, 500);
        assert_eq!(dto.interest_rate, 250);
        assert_eq!(dto.loan_expiration_time, 123);
        assert_eq!(dto.created_at_height, 456);
        assert_eq!(dto.created_at_txid, "ccbbaa");
    }

    #[test]
    fn offer_list_item_full_from_model_maps_nested_and_extra_fields() {
        let id = Uuid::new_v4();
        let model = OfferModel {
            id,
            borrower_pubkey: vec![0x11, 0x22],
            borrower_output_script_hash: vec![0x33, 0x44],
            collateral_asset_id: vec![0x01, 0x02],
            principal_asset_id: vec![0x03, 0x04],
            first_parameters_nft_asset_id: vec![0x05, 0x06],
            second_parameters_nft_asset_id: vec![0x07, 0x08],
            borrower_nft_asset_id: vec![0x09, 0x0a],
            lender_nft_asset_id: vec![0x0b, 0x0c],
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
        assert_eq!(dto.borrower_pubkey, "1122");
        assert_eq!(dto.borrower_output_script_hash, "3344");
        assert_eq!(dto.first_parameters_nft_asset, "0605");
        assert_eq!(dto.second_parameters_nft_asset, "0807");
        assert_eq!(dto.borrower_nft_asset, "0a09");
        assert_eq!(dto.lender_nft_asset, "0c0b");
    }
}
