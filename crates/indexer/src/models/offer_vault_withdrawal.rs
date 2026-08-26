use crate::models::VaultType;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct OfferVaultWithdrawalModel {
    pub id: i64,
    pub offer_id: i64,
    pub vault_type: VaultType,
    pub txid: Vec<u8>,
    pub height: i64,
    pub is_full: bool,
    pub amount_withdrawn: i64,
    pub vault_amount_before: i64,
    pub vault_amount_after: i64,
}
