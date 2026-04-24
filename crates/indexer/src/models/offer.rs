use serde::{Deserialize, Serialize};
use uuid::Uuid;

use simplex::simplicityhl::elements::{Txid, hashes::Hash};

use lending_contracts::programs::pre_lock::PreLockParameters;

use crate::models::{ParticipantType, UtxoType};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UtxoData {
    Offer(UtxoType),
    Participant(ParticipantType),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ActiveUtxo {
    pub offer_id: Uuid,
    pub data: UtxoData,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, sqlx::Type, Serialize, Deserialize)]
#[sqlx(type_name = "offer_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum OfferStatus {
    Pending,
    Active,
    Repaid,
    Liquidated,
    Cancelled,
    Claimed,
}

#[derive(Debug, sqlx::FromRow)]
pub struct OfferModel {
    pub id: Uuid,
    pub borrower_pubkey: Vec<u8>,
    pub borrower_output_script_hash: Vec<u8>,
    pub collateral_asset_id: Vec<u8>,
    pub principal_asset_id: Vec<u8>,
    pub first_parameters_nft_asset_id: Vec<u8>,
    pub second_parameters_nft_asset_id: Vec<u8>,
    pub borrower_nft_asset_id: Vec<u8>,
    pub lender_nft_asset_id: Vec<u8>,
    pub collateral_amount: i64,
    pub principal_amount: i64,
    pub interest_rate: i32,
    pub loan_expiration_time: i32,
    pub current_status: OfferStatus,
    pub created_at_height: i64,
    pub created_at_txid: Vec<u8>,
}

impl OfferModel {
    pub fn new(pre_lock_parameters: &PreLockParameters, block_height: u64, txid: Txid) -> Self {
        Self {
            id: Uuid::new_v4(),
            borrower_pubkey: pre_lock_parameters.borrower_pubkey.serialize().to_vec(),
            borrower_output_script_hash: pre_lock_parameters.borrower_output_script_hash.to_vec(),
            collateral_asset_id: pre_lock_parameters
                .collateral_asset_id
                .into_inner()
                .0
                .to_vec(),
            principal_asset_id: pre_lock_parameters
                .principal_asset_id
                .into_inner()
                .0
                .to_vec(),
            first_parameters_nft_asset_id: pre_lock_parameters
                .first_parameters_nft_asset_id
                .into_inner()
                .0
                .to_vec(),
            second_parameters_nft_asset_id: pre_lock_parameters
                .second_parameters_nft_asset_id
                .into_inner()
                .0
                .to_vec(),
            borrower_nft_asset_id: pre_lock_parameters
                .borrower_nft_asset_id
                .into_inner()
                .0
                .to_vec(),
            lender_nft_asset_id: pre_lock_parameters
                .lender_nft_asset_id
                .into_inner()
                .0
                .to_vec(),
            collateral_amount: pre_lock_parameters.offer_parameters.collateral_amount as i64,
            principal_amount: pre_lock_parameters.offer_parameters.principal_amount as i64,
            interest_rate: pre_lock_parameters.offer_parameters.principal_interest_rate as i32,
            loan_expiration_time: pre_lock_parameters.offer_parameters.loan_expiration_time as i32,
            current_status: OfferStatus::Pending,
            created_at_height: block_height as i64,
            created_at_txid: txid.as_byte_array().to_vec(),
        }
    }
}

#[derive(Debug, sqlx::FromRow)]
pub struct OfferModelShort {
    pub id: Uuid,
    pub collateral_asset_id: Vec<u8>,
    pub principal_asset_id: Vec<u8>,
    pub collateral_amount: i64,
    pub principal_amount: i64,
    pub interest_rate: i32,
    pub loan_expiration_time: i32,
    pub current_status: OfferStatus,
    pub created_at_height: i64,
    pub created_at_txid: Vec<u8>,
}

#[cfg(test)]
mod tests {
    use super::{OfferModel, OfferStatus};
    use lending_contracts::{programs::PreLockParameters, utils::LendingOfferParameters};
    use simplex::{
        provider::SimplicityNetwork,
        simplicityhl::elements::{AssetId, Txid, hashes::Hash, secp256k1_zkp::XOnlyPublicKey},
    };
    use std::str::FromStr;

    fn make_pre_lock_params() -> PreLockParameters {
        PreLockParameters {
            collateral_asset_id: AssetId::from_slice(&[1_u8; 32]).expect("asset"),
            principal_asset_id: AssetId::from_slice(&[2_u8; 32]).expect("asset"),
            first_parameters_nft_asset_id: AssetId::from_slice(&[3_u8; 32]).expect("asset"),
            second_parameters_nft_asset_id: AssetId::from_slice(&[4_u8; 32]).expect("asset"),
            borrower_nft_asset_id: AssetId::from_slice(&[5_u8; 32]).expect("asset"),
            lender_nft_asset_id: AssetId::from_slice(&[6_u8; 32]).expect("asset"),
            offer_parameters: LendingOfferParameters {
                collateral_amount: 1_000,
                principal_amount: 500,
                loan_expiration_time: 12_345,
                principal_interest_rate: 250,
            },
            borrower_pubkey: XOnlyPublicKey::from_str(
                "7c7db0528e8b7b58e698ac104764f6852d74b5a7335bffcdad0ce799dd7742ec",
            )
            .expect("valid xonly key"),
            borrower_output_script_hash: [9_u8; 32],
            network: SimplicityNetwork::LiquidTestnet,
        }
    }

    #[test]
    fn offer_model_new_maps_all_fields_from_pre_lock_parameters() {
        let params = make_pre_lock_params();
        let block_height = 777_u64;
        let txid = Txid::from_slice(&[10_u8; 32]).expect("txid");

        let model = OfferModel::new(&params, block_height, txid);

        assert_eq!(
            model.borrower_pubkey,
            params.borrower_pubkey.serialize().to_vec()
        );
        assert_eq!(
            model.borrower_output_script_hash,
            params.borrower_output_script_hash.to_vec()
        );
        assert_eq!(
            model.collateral_asset_id,
            params.collateral_asset_id.into_inner().0.to_vec()
        );
        assert_eq!(
            model.principal_asset_id,
            params.principal_asset_id.into_inner().0.to_vec()
        );
        assert_eq!(
            model.first_parameters_nft_asset_id,
            params.first_parameters_nft_asset_id.into_inner().0.to_vec()
        );
        assert_eq!(
            model.second_parameters_nft_asset_id,
            params
                .second_parameters_nft_asset_id
                .into_inner()
                .0
                .to_vec()
        );
        assert_eq!(
            model.borrower_nft_asset_id,
            params.borrower_nft_asset_id.into_inner().0.to_vec()
        );
        assert_eq!(
            model.lender_nft_asset_id,
            params.lender_nft_asset_id.into_inner().0.to_vec()
        );
        assert_eq!(model.collateral_amount, 1_000);
        assert_eq!(model.principal_amount, 500);
        assert_eq!(model.interest_rate, 250);
        assert_eq!(model.loan_expiration_time, 12_345);
        assert_eq!(model.current_status, OfferStatus::Pending);
        assert_eq!(model.created_at_height, block_height as i64);
        assert_eq!(model.created_at_txid, txid.as_byte_array().to_vec());
    }

    #[test]
    fn offer_model_new_generates_non_nil_offer_id() {
        let params = make_pre_lock_params();
        let txid = Txid::from_slice(&[11_u8; 32]).expect("txid");

        let model = OfferModel::new(&params, 1, txid);

        assert_ne!(model.id, uuid::Uuid::nil());
    }
}
