use serde::{Deserialize, Serialize};
use uuid::Uuid;

use simplex::simplicityhl::elements::{AssetId, Txid};

use lending_contracts::programs::{issuance_factory::IssuanceFactory, program::SimplexProgram};

#[derive(Debug, Clone)]
pub struct FactoryIdentity {
    pub factory_asset_id: Vec<u8>,
    pub program_script_pubkey: Vec<u8>,
    pub issuing_utxos_count: i16,
    pub reissuance_flags: i64,
}

impl FactoryIdentity {
    pub fn from_factory_model(model: &FactoryModel) -> Self {
        Self {
            factory_asset_id: model.factory_asset_id.clone(),
            program_script_pubkey: model.program_script_pubkey.clone(),
            issuing_utxos_count: model.issuing_utxos_count,
            reissuance_flags: model.reissuance_flags,
        }
    }
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, sqlx::Type, Serialize, Deserialize, utoipa::ToSchema,
)]
#[sqlx(type_name = "factory_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum FactoryStatus {
    Active,
    Removed,
}

/// Namespace of the factory ids derived from creation txids. Must never change.
const FACTORY_ID_NAMESPACE: Uuid = Uuid::from_u128(0xb41844d9_49d2_4498_86b2_699c5b0c112d);

/// Factory id derived from its creation `txid`, so a re-indexed factory keeps its id.
pub fn factory_id_from_txid(txid: Txid) -> Uuid {
    Uuid::new_v5(&FACTORY_ID_NAMESPACE, txid.as_byte_array())
}

#[derive(Debug, sqlx::FromRow)]
pub struct FactoryModel {
    pub id: Uuid,
    pub factory_asset_id: Vec<u8>,
    pub program_script_pubkey: Vec<u8>,
    pub issuing_utxos_count: i16,
    pub reissuance_flags: i64,
    pub current_status: FactoryStatus,
    pub created_at_height: i64,
    pub created_at_txid: Vec<u8>,
}

impl FactoryModel {
    pub fn new(
        issuance_factory: &IssuanceFactory,
        factory_asset_id: AssetId,
        block_height: u64,
        txid: Txid,
    ) -> Self {
        let factory_parameters = issuance_factory.get_parameters();

        Self {
            id: factory_id_from_txid(txid),
            factory_asset_id: factory_asset_id.to_byte_array().to_vec(),
            program_script_pubkey: issuance_factory.get_script_pubkey().to_bytes(),
            issuing_utxos_count: factory_parameters.issuing_utxos_count as i16,
            reissuance_flags: factory_parameters.reissuance_flags as i64,
            current_status: FactoryStatus::Active,
            created_at_height: block_height as i64,
            created_at_txid: txid.as_byte_array().to_vec(),
        }
    }
}

#[cfg(test)]
mod tests {
    use simplex::simplicityhl::elements::Txid;

    use super::factory_id_from_txid;

    #[test]
    fn factory_id_is_stable_per_creation_txid() {
        let txid = Txid::from_byte_array([1; 32]);

        assert_eq!(factory_id_from_txid(txid), factory_id_from_txid(txid));
        assert_ne!(
            factory_id_from_txid(txid),
            factory_id_from_txid(Txid::from_byte_array([2; 32]))
        );
    }

    #[test]
    fn factory_id_is_pinned() {
        assert_eq!(
            factory_id_from_txid(Txid::from_byte_array([1; 32])).to_string(),
            "7fea3149-4899-5802-ba61-4443f4298160"
        );
    }
}
