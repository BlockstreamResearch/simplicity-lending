use serde::{Deserialize, Serialize};
use uuid::Uuid;

use simplex::simplicityhl::elements::{Txid, hashes::Hash};

use lending_contracts::programs::lending::LendingOfferParameters;

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
    pub issuance_factory_id: Uuid,
    pub collateral_asset_id: Vec<u8>,
    pub principal_asset_id: Vec<u8>,
    pub borrower_nft_asset_id: Vec<u8>,
    pub lender_nft_asset_id: Vec<u8>,
    pub protocol_fee_keeper_asset_id: Vec<u8>,
    pub collateral_amount: i64,
    pub principal_amount: i64,
    pub interest_rate: i32,
    pub loan_expiration_time: i32,
    pub current_status: OfferStatus,
    pub created_at_height: i64,
    pub created_at_txid: Vec<u8>,
}

impl OfferModel {
    pub fn new(
        offer_parameters: &LendingOfferParameters,
        factory_id: Uuid,
        block_height: u64,
        txid: Txid,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            issuance_factory_id: factory_id,
            collateral_asset_id: offer_parameters.collateral_asset_id.into_inner().0.to_vec(),
            principal_asset_id: offer_parameters.principal_asset_id.into_inner().0.to_vec(),
            borrower_nft_asset_id: offer_parameters
                .borrower_nft_asset_id
                .into_inner()
                .0
                .to_vec(),
            lender_nft_asset_id: offer_parameters.lender_nft_asset_id.into_inner().0.to_vec(),
            protocol_fee_keeper_asset_id: offer_parameters
                .protocol_fee_keeper_asset_id
                .into_inner()
                .0
                .to_vec(),
            collateral_amount: offer_parameters.offer_parameters.collateral_amount as i64,
            principal_amount: offer_parameters.offer_parameters.principal_amount as i64,
            interest_rate: offer_parameters.offer_parameters.principal_interest_rate as i32,
            loan_expiration_time: offer_parameters.offer_parameters.loan_expiration_time as i32,
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
    use lending_contracts::programs::lending::{LendingOfferParameters, OfferParameters};
    use simplex::{
        provider::SimplicityNetwork,
        simplicityhl::elements::{AssetId, Txid, hashes::Hash},
    };
    use uuid::Uuid;

    fn make_offer_params() -> LendingOfferParameters {
        LendingOfferParameters {
            collateral_asset_id: AssetId::from_slice(&[1_u8; 32]).expect("asset"),
            principal_asset_id: AssetId::from_slice(&[2_u8; 32]).expect("asset"),
            borrower_nft_asset_id: AssetId::from_slice(&[3_u8; 32]).expect("asset"),
            lender_nft_asset_id: AssetId::from_slice(&[4_u8; 32]).expect("asset"),
            protocol_fee_keeper_asset_id: AssetId::from_slice(&[5_u8; 32]).expect("asset"),
            offer_parameters: OfferParameters {
                collateral_amount: 1_000,
                principal_amount: 500,
                loan_expiration_time: 12_345,
                principal_interest_rate: 250,
            },
            network: SimplicityNetwork::LiquidTestnet,
        }
    }

    #[test]
    fn offer_model_new_maps_all_fields_from_offer_parameters() {
        let params = make_offer_params();
        let block_height = 777_u64;
        let factory_id = Uuid::new_v4();
        let txid = Txid::from_slice(&[10_u8; 32]).expect("txid");

        let model = OfferModel::new(&params, factory_id, block_height, txid);

        assert_eq!(model.issuance_factory_id, factory_id);
        assert_eq!(
            model.collateral_asset_id,
            params.collateral_asset_id.into_inner().0.to_vec()
        );
        assert_eq!(
            model.principal_asset_id,
            params.principal_asset_id.into_inner().0.to_vec()
        );
        assert_eq!(
            model.borrower_nft_asset_id,
            params.borrower_nft_asset_id.into_inner().0.to_vec()
        );
        assert_eq!(
            model.lender_nft_asset_id,
            params.lender_nft_asset_id.into_inner().0.to_vec()
        );
        assert_eq!(
            model.protocol_fee_keeper_asset_id,
            params.protocol_fee_keeper_asset_id.into_inner().0.to_vec()
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
        let params = make_offer_params();
        let txid = Txid::from_slice(&[11_u8; 32]).expect("txid");

        let model = OfferModel::new(&params, Uuid::new_v4(), 1, txid);

        assert_ne!(model.id, Uuid::nil());
    }
}
