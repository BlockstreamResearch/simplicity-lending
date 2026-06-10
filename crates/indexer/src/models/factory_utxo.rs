use uuid::Uuid;

#[derive(Debug, sqlx::FromRow)]
pub struct FactoryUtxoModel {
    pub factory_id: Uuid,
    pub txid: Vec<u8>,
    pub vout: i32,
    pub created_at_height: i64,
    pub spent_txid: Option<Vec<u8>>,
    pub spent_at_height: Option<i64>,
}
