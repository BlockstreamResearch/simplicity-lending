#[derive(Debug, Clone, sqlx::FromRow)]
pub struct OfferRepaymentModel {
    pub id: i64,
    pub offer_id: i64,
    pub txid: Vec<u8>,
    pub height: i64,
    pub amount_repaid: i64,
    pub collateral_unlocked: i64,
    pub debt_before: i64,
    pub debt_after: i64,
    pub collateral_before: i64,
    pub collateral_after: i64,
    pub is_full: bool,
}
