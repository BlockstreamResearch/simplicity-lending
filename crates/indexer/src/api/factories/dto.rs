use serde::Serialize;
use uuid::Uuid;

use simplex::simplicityhl::elements::hex::ToHex;

use crate::api::utils::format_hex;
use crate::models::FactoryStatus;

#[derive(Serialize, PartialEq, Eq, Debug)]
pub struct FactoryProgramUtxoDto {
    pub txid: String,
    pub vout: u32,
    pub created_at_height: u64,
}

#[derive(Serialize, PartialEq, Eq, Debug)]
pub struct FactoryAuthUtxoDto {
    pub txid: String,
    pub vout: u32,
    pub script_pubkey: String,
    pub created_at_height: u64,
}

#[derive(Serialize, PartialEq, Eq, Debug)]
pub struct FactoryDetailsResponse {
    pub id: Uuid,
    pub factory_asset_id: String,
    pub program_script_pubkey: String,
    pub status: FactoryStatus,
    pub issuing_utxos_count: u16,
    pub reissuance_flags: u64,
    pub created_at_height: u64,
    pub created_at_txid: String,
    pub auth_utxo: Option<FactoryAuthUtxoDto>,
    pub program_utxo: Option<FactoryProgramUtxoDto>,
}

#[derive(sqlx::FromRow)]
pub struct FactoryDetailsRow {
    pub id: Uuid,
    pub factory_asset_id: Vec<u8>,
    pub program_script_pubkey: Vec<u8>,
    pub current_status: FactoryStatus,
    pub issuing_utxos_count: i16,
    pub reissuance_flags: i64,
    pub created_at_height: i64,
    pub created_at_txid: Vec<u8>,
    pub auth_txid: Option<Vec<u8>>,
    pub auth_vout: Option<i32>,
    pub auth_script_pubkey: Option<Vec<u8>>,
    pub auth_created_at_height: Option<i64>,
    pub program_txid: Option<Vec<u8>>,
    pub program_vout: Option<i32>,
    pub program_created_at_height: Option<i64>,
}

impl From<FactoryDetailsRow> for FactoryDetailsResponse {
    fn from(row: FactoryDetailsRow) -> Self {
        Self {
            id: row.id,
            factory_asset_id: format_hex(row.factory_asset_id),
            program_script_pubkey: row.program_script_pubkey.to_hex(),
            status: row.current_status,
            issuing_utxos_count: row.issuing_utxos_count as u16,
            reissuance_flags: row.reissuance_flags as u64,
            created_at_height: row.created_at_height as u64,
            created_at_txid: format_hex(row.created_at_txid),
            auth_utxo: map_auth_utxo(
                row.auth_txid,
                row.auth_vout,
                row.auth_script_pubkey,
                row.auth_created_at_height,
            ),
            program_utxo: map_program_utxo(
                row.program_txid,
                row.program_vout,
                row.program_created_at_height,
            ),
        }
    }
}

fn map_auth_utxo(
    txid: Option<Vec<u8>>,
    vout: Option<i32>,
    script_pubkey: Option<Vec<u8>>,
    created_at_height: Option<i64>,
) -> Option<FactoryAuthUtxoDto> {
    Some(FactoryAuthUtxoDto {
        txid: format_hex(txid?),
        vout: vout? as u32,
        script_pubkey: script_pubkey?.to_hex(),
        created_at_height: created_at_height? as u64,
    })
}

fn map_program_utxo(
    txid: Option<Vec<u8>>,
    vout: Option<i32>,
    created_at_height: Option<i64>,
) -> Option<FactoryProgramUtxoDto> {
    Some(FactoryProgramUtxoDto {
        txid: format_hex(txid?),
        vout: vout? as u32,
        created_at_height: created_at_height? as u64,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        FactoryAuthUtxoDto, FactoryDetailsResponse, FactoryDetailsRow, FactoryProgramUtxoDto,
    };
    use crate::models::FactoryStatus;
    use uuid::Uuid;

    #[test]
    fn factory_details_response_from_row_maps_hex_fields() {
        let factory_id = Uuid::new_v4();
        let row = FactoryDetailsRow {
            id: factory_id,
            factory_asset_id: vec![0x01, 0x02],
            program_script_pubkey: vec![0x51, 0xac],
            current_status: FactoryStatus::Active,
            issuing_utxos_count: 2,
            reissuance_flags: 0,
            created_at_height: 100,
            created_at_txid: vec![0xaa, 0xbb],
            auth_txid: Some(vec![0x11, 0x22]),
            auth_vout: Some(0),
            auth_script_pubkey: Some(vec![0x33, 0x44]),
            auth_created_at_height: Some(100),
            program_txid: Some(vec![0x55, 0x66]),
            program_vout: Some(1),
            program_created_at_height: Some(100),
        };

        let response = FactoryDetailsResponse::from(row);

        assert_eq!(response.id, factory_id);
        assert_eq!(response.factory_asset_id, "0201");
        assert_eq!(response.program_script_pubkey, "51ac");
        assert_eq!(response.status, FactoryStatus::Active);
        assert_eq!(response.issuing_utxos_count, 2);
        assert_eq!(response.created_at_txid, "bbaa");
        assert_eq!(
            response.auth_utxo,
            Some(FactoryAuthUtxoDto {
                txid: "2211".to_string(),
                vout: 0,
                script_pubkey: "3344".to_string(),
                created_at_height: 100,
            })
        );
        assert_eq!(
            response.program_utxo,
            Some(FactoryProgramUtxoDto {
                txid: "6655".to_string(),
                vout: 1,
                created_at_height: 100,
            })
        );
    }

    #[test]
    fn factory_details_response_from_row_handles_missing_utxos() {
        let row = FactoryDetailsRow {
            id: Uuid::new_v4(),
            factory_asset_id: vec![0x01],
            program_script_pubkey: vec![0x51],
            current_status: FactoryStatus::Removed,
            issuing_utxos_count: 2,
            reissuance_flags: 0,
            created_at_height: 1,
            created_at_txid: vec![0x10],
            auth_txid: None,
            auth_vout: None,
            auth_script_pubkey: None,
            auth_created_at_height: None,
            program_txid: None,
            program_vout: None,
            program_created_at_height: None,
        };

        let response = FactoryDetailsResponse::from(row);

        assert_eq!(response.status, FactoryStatus::Removed);
        assert_eq!(response.auth_utxo, None);
        assert_eq!(response.program_utxo, None);
    }
}
