use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use crate::api::params::{DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT};

#[derive(Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
pub struct ProtocolFeeVaultsQuery {
    #[param(example = "020202…")]
    pub principal_asset: String,
    #[param(minimum = 0, maximum = 100, example = 50)]
    pub limit: Option<u64>,
    #[param(minimum = 0, example = 0)]
    pub offset: Option<u64>,
}

impl ProtocolFeeVaultsQuery {
    pub fn effective_limit(&self) -> u64 {
        self.limit.unwrap_or(DEFAULT_LIST_LIMIT).min(MAX_LIST_LIMIT)
    }

    pub fn effective_offset(&self) -> u64 {
        self.offset.unwrap_or(0)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ProtocolFeeVaultDto {
    #[schema(example = "1")]
    pub offer_id: String,
    pub txid: String,
    pub vout: u32,
    #[schema(example = "1000")]
    pub amount: String,
    #[schema(example = "1000")]
    pub supply_goal: String,
    pub borrower_nft_asset: String,
    pub protocol_fee_keeper_asset: String,
    pub created_at_height: u64,
    pub updated_at_height: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct ProtocolFeeVaultsResponse {
    pub items: Vec<ProtocolFeeVaultDto>,
    pub total_count: u64,
    pub limit: u64,
    pub offset: u64,
    #[schema(example = "1500")]
    pub total_amount: String,
}

#[cfg(test)]
mod tests {
    use super::{ProtocolFeeVaultDto, ProtocolFeeVaultsResponse};

    #[test]
    fn protocol_fee_vaults_response_serializes_expected_shape() {
        let response = ProtocolFeeVaultsResponse {
            items: vec![ProtocolFeeVaultDto {
                offer_id: "1".to_string(),
                txid: "aabb".to_string(),
                vout: 0,
                amount: "1000".to_string(),
                supply_goal: "1000".to_string(),
                borrower_nft_asset: "0102".to_string(),
                protocol_fee_keeper_asset: "0304".to_string(),
                created_at_height: 10,
                updated_at_height: 10,
            }],
            total_count: 1,
            limit: 50,
            offset: 0,
            total_amount: "1000".to_string(),
        };

        let json = serde_json::to_value(&response).expect("serialize");
        assert_eq!(json["total_count"], 1);
        assert_eq!(json["limit"], 50);
        assert_eq!(json["offset"], 0);
        assert_eq!(json["total_amount"], "1000");
        assert_eq!(json["items"][0]["borrower_nft_asset"], "0102");
        assert_eq!(json["items"][0]["protocol_fee_keeper_asset"], "0304");
        assert_eq!(json["items"][0]["supply_goal"], "1000");
    }
}
