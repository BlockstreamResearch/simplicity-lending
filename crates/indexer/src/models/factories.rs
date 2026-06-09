use serde::{Deserialize, Serialize};
use uuid::Uuid;

use simplex::simplicityhl::elements::{AssetId, Txid, hashes::Hash};

use lending_contracts::programs::{issuance_factory::IssuanceFactory, program::SimplexProgram};

#[derive(Debug, Clone)]
pub struct FactoryIdentity {
    pub factory_asset_id: Vec<u8>,
    pub program_script_pubkey: Vec<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, sqlx::Type, Serialize, Deserialize)]
#[sqlx(type_name = "factory_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum FactoryStatus {
    Active,
    Removed,
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
            id: Uuid::new_v4(),
            factory_asset_id: factory_asset_id.into_inner().0.to_vec(),
            program_script_pubkey: issuance_factory.get_script_pubkey().to_bytes(),
            issuing_utxos_count: factory_parameters.issuing_utxos_count as i16,
            reissuance_flags: factory_parameters.reissuance_flags as i64,
            current_status: FactoryStatus::Active,
            created_at_height: block_height as i64,
            created_at_txid: txid.as_byte_array().to_vec(),
        }
    }
}
