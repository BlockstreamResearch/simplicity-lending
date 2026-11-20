use simplex::{provider::SimplicityNetwork, simplicityhl::elements::AssetId};

use crate::{
    artifacts::lending::derived_lending::LendingArguments,
    programs::{
        asset_auth::{AssetAuth, AssetAuthParameters},
        asset_auth_vault::{AssetAuthVault, AssetAuthVaultParameters},
        lending::OfferParameters,
        program::SimplexProgram,
    },
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LendingOfferParameters {
    pub collateral_asset_id: AssetId,
    pub principal_asset_id: AssetId,
    pub borrower_nft_asset_id: AssetId,
    pub lender_nft_asset_id: AssetId,
    pub protocol_fee_keeper_asset_id: AssetId,
    pub offer_parameters: OfferParameters,
    pub network: SimplicityNetwork,
}

impl LendingOfferParameters {
    pub fn get_principal_output_asset_auth(&self) -> AssetAuth {
        AssetAuth::new(AssetAuthParameters {
            asset_id: self.borrower_nft_asset_id,
            asset_amount: 1,
            with_asset_burn: false,
            network: self.network,
        })
    }

    /// Lender vault state at `current_debt`. Before the first repayment the vault does not exist
    /// on-chain yet, see [`OfferParameters::has_lender_vault`].
    pub fn get_lender_vault(&self, current_debt: u64) -> AssetAuthVault {
        let already_repaid_amount = self
            .offer_parameters
            .get_already_repaid_amount(current_debt);
        let already_repaid_protocol_fee = self
            .offer_parameters
            .get_already_repaid_protocol_fee(current_debt);

        AssetAuthVault::new_with_supplied(
            self.get_lender_vault_parameters(),
            already_repaid_amount - already_repaid_protocol_fee,
        )
    }

    /// Protocol fee vault state at `current_debt`. The vault does not exist on-chain until some
    /// protocol fee is repaid, see [`OfferParameters::has_protocol_fee_vault`].
    pub fn get_protocol_fee_vault(&self, current_debt: u64) -> AssetAuthVault {
        AssetAuthVault::new_with_supplied(
            self.get_protocol_fee_vault_parameters(),
            self.offer_parameters
                .get_already_repaid_protocol_fee(current_debt),
        )
    }

    pub fn get_lender_vault_parameters(&self) -> AssetAuthVaultParameters {
        AssetAuthVaultParameters {
            vault_asset_id: self.principal_asset_id,
            keeper_asset_id: self.lender_nft_asset_id,
            supplier_asset_id: self.borrower_nft_asset_id,
            supply_goal: self.offer_parameters.get_total_amount_to_repay()
                - self.offer_parameters.get_total_protocol_fee(),
            liquidation_height: self.offer_parameters.loan_expiration_time,
            with_keeper_asset_burn: true,
            with_supplier_asset_burn: true,
            network: self.network,
        }
    }

    pub fn get_protocol_fee_vault_parameters(&self) -> AssetAuthVaultParameters {
        AssetAuthVaultParameters {
            vault_asset_id: self.principal_asset_id,
            keeper_asset_id: self.protocol_fee_keeper_asset_id,
            supplier_asset_id: self.borrower_nft_asset_id,
            supply_goal: self.offer_parameters.get_total_protocol_fee(),
            liquidation_height: 0,
            with_keeper_asset_burn: false,
            with_supplier_asset_burn: false,
            network: self.network,
        }
    }

    pub fn build_arguments(&self) -> LendingArguments {
        LendingArguments {
            collateral_asset_id: self.collateral_asset_id.to_byte_array(),
            principal_asset_id: self.principal_asset_id.to_byte_array(),
            borrower_nft_asset_id: self.borrower_nft_asset_id.to_byte_array(),
            lender_nft_asset_id: self.lender_nft_asset_id.to_byte_array(),
            collateral_amount: self.offer_parameters.collateral_amount,
            principal_amount: self.offer_parameters.principal_amount,
            principal_interest_rate: self.offer_parameters.principal_interest_rate as u64,
            protocol_fee_rate: self.offer_parameters.protocol_fee_rate as u64,
            loan_expiration_time: self.offer_parameters.loan_expiration_time,
            lender_vault_tapleaf_hash: self.get_lender_vault_tapleaf_hash(),
            protocol_fee_vault_tapleaf_hash: self.get_protocol_fee_vault_tapleaf_hash(),
            principal_output_script_hash: self.get_principal_output_asset_auth().get_script_hash(),
        }
    }

    fn get_lender_vault_tapleaf_hash(&self) -> [u8; 32] {
        AssetAuthVault::get_program_tapleaf_hash(self.get_lender_vault_parameters())
    }

    fn get_protocol_fee_vault_tapleaf_hash(&self) -> [u8; 32] {
        AssetAuthVault::get_program_tapleaf_hash(self.get_protocol_fee_vault_parameters())
    }
}

#[cfg(test)]
mod tests {
    use simplex::{provider::SimplicityNetwork, simplicityhl::elements::AssetId};

    use crate::programs::lending::{OfferParameters, calculate_protocol_fee};

    use super::LendingOfferParameters;

    fn asset(byte: u8) -> AssetId {
        AssetId::from_byte_array([byte; 32])
    }

    fn test_params() -> LendingOfferParameters {
        LendingOfferParameters {
            collateral_asset_id: asset(1),
            principal_asset_id: asset(2),
            borrower_nft_asset_id: asset(3),
            lender_nft_asset_id: asset(4),
            protocol_fee_keeper_asset_id: asset(5),
            offer_parameters: OfferParameters {
                collateral_amount: 1_000,
                principal_amount: 1_000,
                loan_expiration_time: 100_000,
                principal_interest_rate: 1_000, // total_fee = 100, total_protocol_fee = 10
                protocol_fee_rate: 1_000,
            },
            network: SimplicityNetwork::default_regtest(),
        }
    }

    #[test]
    fn get_protocol_fee_vault_already_supplied_matches_onchain_floor() {
        let params = test_params();
        let current_debt = 1_100 - 45; // already_repaid_fee = 45, still in RepayingOfferFee phase

        let onchain_already_repaid_protocol_fee = calculate_protocol_fee(45, 1_000);
        assert_eq!(onchain_already_repaid_protocol_fee, 4);

        let reconstructed_already_supplied = params
            .get_protocol_fee_vault(current_debt)
            .get_already_supplied_amount();

        assert_eq!(
            reconstructed_already_supplied,
            onchain_already_repaid_protocol_fee
        );
    }

    #[test]
    fn get_lender_vault_already_supplied_matches_onchain_floor() {
        let params = test_params();
        let current_debt = 1_100 - 45;

        let onchain_already_repaid_protocol_fee = calculate_protocol_fee(45, 1_000);
        let onchain_lender_vault_already_supplied = 45 - onchain_already_repaid_protocol_fee;
        assert_eq!(onchain_lender_vault_already_supplied, 41);

        let reconstructed_already_supplied = params
            .get_lender_vault(current_debt)
            .get_already_supplied_amount();

        assert_eq!(
            reconstructed_already_supplied,
            onchain_lender_vault_already_supplied,
        );
    }

    #[test]
    fn zero_protocol_fee_rate_builds_arguments() {
        let mut params = test_params();
        params.offer_parameters.protocol_fee_rate = 0;

        let arguments = params.build_arguments();
        assert_eq!(arguments.protocol_fee_rate, 0);

        let protocol_fee_vault = params.get_protocol_fee_vault(1_000);
        assert!(protocol_fee_vault.is_finalized_offer());
        assert_eq!(protocol_fee_vault.get_already_supplied_amount(), 0);

        let lender_vault = params.get_lender_vault(0);
        assert!(lender_vault.is_finalized_offer());
        assert_eq!(lender_vault.get_already_supplied_amount(), 1_100);
    }
}
