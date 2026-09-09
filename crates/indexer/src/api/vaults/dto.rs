use serde::Deserialize;
use utoipa::{IntoParams, ToSchema};

#[derive(Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
pub struct ProtocolFeeVaultsQuery {
    #[param(example = "020202…")]
    pub principal_asset: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, ToSchema)]
pub struct ProtocolFeeVaultDto {
    #[schema(example = "1")]
    pub offer_id: String,
    pub txid: String,
    pub vout: u32,
    #[schema(example = "1000")]
    pub amount: String,
    pub borrower_nft_asset: String,
    pub protocol_fee_keeper_asset: String,
    pub created_at_height: u64,
    pub updated_at_height: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, ToSchema)]
pub struct ProtocolFeeVaultsResponse {
    pub items: Vec<ProtocolFeeVaultDto>,
    pub count: u64,
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
                borrower_nft_asset: "0102".to_string(),
                protocol_fee_keeper_asset: "0304".to_string(),
                created_at_height: 10,
                updated_at_height: 10,
            }],
            count: 1,
            total_amount: "1000".to_string(),
        };

        let json = serde_json::to_value(&response).expect("serialize");
        assert_eq!(json["count"], 1);
        assert_eq!(json["total_amount"], "1000");
        assert_eq!(json["items"][0]["borrower_nft_asset"], "0102");
        assert_eq!(json["items"][0]["protocol_fee_keeper_asset"], "0304");
    }
}
