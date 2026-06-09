#[derive(Debug, Clone)]
pub struct FactoryIdentity {
    pub factory_asset_id: Vec<u8>,
    pub program_script_pubkey: Vec<u8>,
}
