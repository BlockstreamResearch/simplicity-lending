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

#[derive(Debug, Clone, Copy)]
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

    pub fn get_lender_vault(&self, current_debt: u64) -> AssetAuthVault {
        let parameters = self.get_lender_vault_parameters();

        let already_repaid_amount = self
            .offer_parameters
            .get_already_repaid_amount(current_debt);
        let already_repaid_protocol_fee = self
            .offer_parameters
            .get_already_repaid_protocol_fee(current_debt);

        let already_supplied = already_repaid_amount - already_repaid_protocol_fee;

        if already_supplied >= parameters.supply_goal {
            AssetAuthVault::new_finalized(parameters)
        } else {
            AssetAuthVault::new_active(parameters, already_supplied)
        }
    }

    pub fn get_protocol_fee_vault(&self, current_debt: u64) -> AssetAuthVault {
        let parameters = self.get_protocol_fee_vault_parameters();

        let already_repaid_protocol_fee = self
            .offer_parameters
            .get_already_repaid_protocol_fee(current_debt);

        if already_repaid_protocol_fee >= parameters.supply_goal {
            AssetAuthVault::new_finalized(parameters)
        } else {
            AssetAuthVault::new_active(parameters, already_repaid_protocol_fee)
        }
    }

    pub fn get_lender_vault_parameters(&self) -> AssetAuthVaultParameters {
        AssetAuthVaultParameters {
            vault_asset_id: self.principal_asset_id,
            keeper_asset_id: self.lender_nft_asset_id,
            supplier_asset_id: self.borrower_nft_asset_id,
            supply_goal: self.offer_parameters.get_total_amount_to_repay()
                - self.offer_parameters.get_total_protocol_fee(),
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
            with_keeper_asset_burn: false,
            with_supplier_asset_burn: false,
            network: self.network,
        }
    }

    pub fn build_arguments(&self) -> LendingArguments {
        LendingArguments {
            collateral_asset_id: self.collateral_asset_id.into_inner().0,
            principal_asset_id: self.principal_asset_id.into_inner().0,
            borrower_nft_asset_id: self.borrower_nft_asset_id.into_inner().0,
            lender_nft_asset_id: self.lender_nft_asset_id.into_inner().0,
            collateral_amount: self.offer_parameters.collateral_amount,
            principal_amount: self.offer_parameters.principal_amount,
            principal_interest_rate: self.offer_parameters.principal_interest_rate as u64,
            loan_expiration_time: self.offer_parameters.loan_expiration_time,
            lender_vault_tapleaf_hash: self.get_lender_vault_tapleaf_hash(),
            protocol_fee_vault_tapleaf_hash: self.get_protocol_fee_vault_tapleaf_hash(),
            principal_output_script_hash: self.get_principal_output_asset_auth().get_script_hash(),
        }
    }

    fn get_lender_vault_tapleaf_hash(&self) -> [u8; 32] {
        AssetAuthVault::new_active(self.get_lender_vault_parameters(), 0).get_tapleaf_hash()
    }

    fn get_protocol_fee_vault_tapleaf_hash(&self) -> [u8; 32] {
        AssetAuthVault::new_active(self.get_protocol_fee_vault_parameters(), 0).get_tapleaf_hash()
    }
}

#[cfg(test)]
mod tests {
    use simplex::{provider::SimplicityNetwork, simplicityhl::elements::AssetId};

    use crate::programs::lending::{OfferParameters, calculate_protocol_fee};

    use super::LendingOfferParameters;

    fn asset(byte: u8) -> AssetId {
        AssetId::from_slice(&[byte; 32]).expect("asset")
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
            },
            network: SimplicityNetwork::default_regtest(),
        }
    }

    #[test]
    fn get_protocol_fee_vault_already_supplied_matches_onchain_floor() {
        let params = test_params();
        let current_debt = 1_100 - 45; // already_repaid_fee = 45, still in RepayingOfferFee phase

        let onchain_already_repaid_protocol_fee = calculate_protocol_fee(45);
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

        let onchain_already_repaid_protocol_fee = calculate_protocol_fee(45);
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
}
