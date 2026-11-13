use simplex::simplicityhl::elements::AssetId;

use crate::artifacts::contracts::vault::lender_principal_vault::derived_lender_principal_vault::LenderPrincipalVaultArguments;

/// The parameters every vault of a protocol deployment shares.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LenderPrincipalVaultParameters {
    pub principal_asset_id: AssetId,
    pub protocol_harvester_asset_id: AssetId,
    pub protocol_fee_rate: u64,
    pub min_vault_balance: u64,
}

impl LenderPrincipalVaultParameters {
    #[must_use]
    pub fn build_arguments(&self) -> LenderPrincipalVaultArguments {
        LenderPrincipalVaultArguments {
            principal_asset_id: self.principal_asset_id.to_byte_array(),
            protocol_harvester_asset_id: self.protocol_harvester_asset_id.to_byte_array(),
            protocol_fee_rate: self.protocol_fee_rate,
            min_vault_balance: self.min_vault_balance,
        }
    }
}
