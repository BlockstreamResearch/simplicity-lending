use std::str::FromStr;

use anyhow::Context;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use lending_contracts::programs::lending::{LendingOffer, LendingOfferParameters, OfferParameters};
use simplex::{
    provider::SimplicityNetwork,
    simplicityhl::elements::{AssetId, Txid, hashes::Hash},
};

use crate::models::{ParticipantType, UtxoType};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UtxoData {
    Offer(UtxoType),
    Participant(ParticipantType),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ActiveUtxo {
    pub offer_id: i64,
    pub data: UtxoData,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, sqlx::Type, Serialize, Deserialize, utoipa::ToSchema,
)]
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

impl FromStr for OfferStatus {
    type Err = &'static str;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "pending" => Ok(Self::Pending),
            "active" => Ok(Self::Active),
            "repaid" => Ok(Self::Repaid),
            "liquidated" => Ok(Self::Liquidated),
            "cancelled" => Ok(Self::Cancelled),
            "claimed" => Ok(Self::Claimed),
            _ => Err("unknown offer status"),
        }
    }
}

impl OfferStatus {
    pub fn as_query_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Active => "active",
            Self::Repaid => "repaid",
            Self::Liquidated => "liquidated",
            Self::Cancelled => "cancelled",
            Self::Claimed => "claimed",
        }
    }

    pub fn parse_csv(segment: &str) -> Result<Vec<Self>, &'static str> {
        segment
            .split(',')
            .map(str::trim)
            .filter(|part| !part.is_empty())
            .map(str::parse)
            .collect()
    }
}

#[derive(Debug, sqlx::FromRow)]
pub struct OfferModel {
    pub id: i64,
    pub issuance_factory_id: Uuid,
    pub collateral_asset_id: Vec<u8>,
    pub principal_asset_id: Vec<u8>,
    pub borrower_nft_asset_id: Vec<u8>,
    pub lender_nft_asset_id: Vec<u8>,
    pub protocol_fee_keeper_asset_id: Vec<u8>,
    pub collateral_amount: i64,
    pub principal_amount: i64,
    pub current_debt: i64,
    pub collateral_remaining: i64,
    pub interest_rate: i32,
    pub loan_expiration_time: i32,
    pub current_status: OfferStatus,
    pub updated_at_height: i64,
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
        let collateral_amount = offer_parameters.offer_parameters.collateral_amount as i64;
        let current_debt = offer_parameters
            .offer_parameters
            .get_total_amount_to_repay() as i64;

        Self {
            id: 0,
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
            collateral_amount,
            principal_amount: offer_parameters.offer_parameters.principal_amount as i64,
            current_debt,
            collateral_remaining: collateral_amount,
            interest_rate: offer_parameters.offer_parameters.principal_interest_rate as i32,
            loan_expiration_time: offer_parameters.offer_parameters.loan_expiration_time as i32,
            current_status: OfferStatus::Pending,
            updated_at_height: block_height as i64,
            created_at_height: block_height as i64,
            created_at_txid: txid.as_byte_array().to_vec(),
        }
    }

    pub fn to_lending_offer_parameters(
        &self,
        network: SimplicityNetwork,
    ) -> anyhow::Result<LendingOfferParameters> {
        let asset = |bytes: &[u8], field: &str| -> anyhow::Result<AssetId> {
            AssetId::from_slice(bytes).map_err(|e| anyhow::anyhow!("invalid {field}: {e}"))
        };

        let interest_rate = u16::try_from(self.interest_rate)
            .with_context(|| format!("interest_rate out of range: {}", self.interest_rate))?;
        let loan_expiration_time = u32::try_from(self.loan_expiration_time).with_context(|| {
            format!(
                "loan_expiration_time out of range: {}",
                self.loan_expiration_time
            )
        })?;

        Ok(LendingOfferParameters {
            collateral_asset_id: asset(&self.collateral_asset_id, "collateral_asset_id")?,
            principal_asset_id: asset(&self.principal_asset_id, "principal_asset_id")?,
            borrower_nft_asset_id: asset(&self.borrower_nft_asset_id, "borrower_nft_asset_id")?,
            lender_nft_asset_id: asset(&self.lender_nft_asset_id, "lender_nft_asset_id")?,
            protocol_fee_keeper_asset_id: asset(
                &self.protocol_fee_keeper_asset_id,
                "protocol_fee_keeper_asset_id",
            )?,
            offer_parameters: OfferParameters {
                collateral_amount: self.collateral_amount as u64,
                principal_amount: self.principal_amount as u64,
                loan_expiration_time,
                principal_interest_rate: interest_rate,
            },
            network,
        })
    }

    pub fn to_active_lending_offer(
        &self,
        network: SimplicityNetwork,
    ) -> anyhow::Result<LendingOffer> {
        let params = self.to_lending_offer_parameters(network)?;

        Ok(LendingOffer::new_active(params, self.current_debt as u64))
    }
}

#[derive(Debug, sqlx::FromRow)]
pub struct OfferModelShort {
    pub id: i64,
    pub issuance_factory_id: Uuid,
    pub collateral_asset_id: Vec<u8>,
    pub principal_asset_id: Vec<u8>,
    pub collateral_amount: i64,
    pub principal_amount: i64,
    pub current_debt: i64,
    pub collateral_remaining: i64,
    pub interest_rate: i32,
    pub loan_expiration_time: i32,
    pub current_status: OfferStatus,
    pub updated_at_height: i64,
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
        assert_eq!(model.current_debt, 512);
        assert_eq!(model.collateral_remaining, 1_000);
        assert_eq!(model.interest_rate, 250);
        assert_eq!(model.loan_expiration_time, 12_345);
        assert_eq!(model.current_status, OfferStatus::Pending);
        assert_eq!(model.updated_at_height, block_height as i64);
        assert_eq!(model.created_at_height, block_height as i64);
        assert_eq!(model.created_at_txid, txid.as_byte_array().to_vec());
    }

    #[test]
    fn offer_model_to_active_lending_offer_roundtrips_script_and_debt() {
        use lending_contracts::programs::{lending::LendingOffer, program::SimplexProgram};

        let params = make_offer_params();
        let debt = params.offer_parameters.get_total_amount_to_repay();
        let mut model = OfferModel::new(&params, Uuid::nil(), 0, Txid::from_byte_array([0u8; 32]));
        model.current_debt = debt as i64;

        let from_model = model
            .to_active_lending_offer(SimplicityNetwork::LiquidTestnet)
            .unwrap();
        let expected = LendingOffer::new_active(params, debt);

        assert_eq!(from_model.get_script_pubkey(), expected.get_script_pubkey());
        assert_eq!(from_model.get_current_debt(), expected.get_current_debt());
    }

    #[test]
    fn offer_status_from_str_and_parse_csv() {
        assert_eq!(
            "active".parse::<OfferStatus>().unwrap(),
            OfferStatus::Active
        );
        assert!("invalid".parse::<OfferStatus>().is_err());

        assert_eq!(
            OfferStatus::parse_csv("pending, active").unwrap(),
            vec![OfferStatus::Pending, OfferStatus::Active],
        );
    }
}
