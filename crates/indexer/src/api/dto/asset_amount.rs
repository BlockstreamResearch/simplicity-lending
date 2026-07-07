use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct AssetAmount {
    pub asset: String,
    /// Amount in satoshis (decimal string).
    #[schema(example = "1000")]
    pub amount: String,
}
