use serde::Serialize;
use utoipa::ToSchema;

#[derive(Serialize, ToSchema)]
pub struct AssetAmount {
    pub asset: String,
    /// Amount in satoshis (decimal string).
    #[schema(example = "1000")]
    pub amount: String,
}
