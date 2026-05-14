use std::cmp::min;

use simplex::{
    provider::SimplicityNetwork,
    simplicityhl::elements::{AssetId, schnorr::XOnlyPublicKey},
};

use crate::{
    artifacts::lending::derived_lending::LendingArguments,
    programs::{
        asset_auth_vault::{
            ActiveAssetAuthVault, FinalizedAssetAuthVault, FinalizedAssetAuthVaultParameters,
        },
        program::SimplexProgram,
    },
    utils::apply_basis_points,
};

#[derive(Debug, Clone, Copy)]
pub struct LendingParameters {
    pub collateral_asset_id: AssetId,
    pub principal_asset_id: AssetId,
    pub borrower_debt_nft_asset_id: AssetId,
    pub lender_nft_asset_id: AssetId,
    pub protocol_fee_keeper_asset_id: AssetId,
    pub collateral_amount: u64,
    pub principal_amount: u64,
    pub loan_expiration_time: u32,
    pub principal_interest_rate: u16,
    pub borrower_pubkey: XOnlyPublicKey,
    pub network: SimplicityNetwork,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LendingOfferRepaymentPhase {
    NoRepayments,
    RepayingOfferFee,
    RepayingPrincipal,
    Repaid,
}

pub const PROTOCOL_FEE_PERCENTAGE: u16 = 1_000; // 10%

impl LendingParameters {
    pub fn calculate_protocol_fee(fee_amount: u64) -> u64 {
        apply_basis_points(fee_amount, PROTOCOL_FEE_PERCENTAGE).unwrap()
    }

    pub fn get_total_fee(&self) -> u64 {
        apply_basis_points(self.principal_amount, self.principal_interest_rate).unwrap()
    }

    pub fn get_total_protocol_fee(&self) -> u64 {
        Self::calculate_protocol_fee(self.get_total_fee())
    }

    pub fn get_fee_to_repay(&self, current_debt: u64) -> u64 {
        let total_fee = self.get_total_fee();

        let already_repaid_amount = self.get_already_repaid_amount(current_debt);
        let already_repaid_fee = min(total_fee, already_repaid_amount);

        total_fee - already_repaid_fee
    }

    pub fn get_protocol_fee_to_repay(&self, current_debt: u64) -> u64 {
        Self::calculate_protocol_fee(self.get_fee_to_repay(current_debt))
    }

    pub fn get_repaid_fee(&self, current_debt: u64, amount_to_repay: u64) -> u64 {
        let fee_left = self.get_fee_to_repay(current_debt);

        min(fee_left, amount_to_repay)
    }

    pub fn get_repaid_protocol_fee(&self, current_debt: u64, amount_to_repay: u64) -> u64 {
        Self::calculate_protocol_fee(self.get_repaid_fee(current_debt, amount_to_repay))
    }

    pub fn get_total_amount_to_repay(&self) -> u64 {
        self.principal_amount + self.get_total_fee()
    }

    pub fn get_already_repaid_amount(&self, current_debt: u64) -> u64 {
        let total_amount_to_repay = self.get_total_amount_to_repay();

        if current_debt >= total_amount_to_repay {
            return 0;
        } else {
            total_amount_to_repay - current_debt
        }
    }

    pub fn get_repayment_phase(&self, offer_debt: u64) -> LendingOfferRepaymentPhase {
        let total_amount_to_repay = self.get_total_amount_to_repay();

        if offer_debt >= total_amount_to_repay {
            return LendingOfferRepaymentPhase::NoRepayments;
        }

        if offer_debt == 0 {
            return LendingOfferRepaymentPhase::Repaid;
        }

        let total_fee = self.get_total_fee();
        let repaid_amount = total_amount_to_repay - offer_debt;

        if total_fee > repaid_amount {
            return LendingOfferRepaymentPhase::RepayingOfferFee;
        } else {
            return LendingOfferRepaymentPhase::RepayingPrincipal;
        }
    }

    pub fn get_active_lender_vault(&self) -> ActiveAssetAuthVault {
        ActiveAssetAuthVault::from_finalized_vault(self.get_lender_vault_finalized_parameters())
    }

    pub fn get_active_protocol_fee_vault(&self) -> ActiveAssetAuthVault {
        ActiveAssetAuthVault::from_finalized_vault(
            self.get_protocol_fee_vault_finalized_parameters(),
        )
    }

    pub fn get_finalized_lender_vault(&self) -> FinalizedAssetAuthVault {
        FinalizedAssetAuthVault::new(self.get_lender_vault_finalized_parameters())
    }

    pub fn get_finalized_protocol_fee_vault(&self) -> FinalizedAssetAuthVault {
        FinalizedAssetAuthVault::new(self.get_protocol_fee_vault_finalized_parameters())
    }

    pub fn build_arguments(&self) -> LendingArguments {
        LendingArguments {
            collateral_asset_id: self.collateral_asset_id.into_inner().0,
            principal_asset_id: self.principal_asset_id.into_inner().0,
            borrower_debt_nft_asset_id: self.borrower_debt_nft_asset_id.into_inner().0,
            lender_nft_asset_id: self.lender_nft_asset_id.into_inner().0,
            collateral_amount: self.collateral_amount,
            principal_amount: self.principal_amount,
            principal_interest_rate: self.principal_interest_rate as u64,
            loan_expiration_time: self.loan_expiration_time,
            lender_vault_cov_hash: self.get_active_lender_vault().get_script_hash(),
            finalized_lender_vault_cov_hash: self.get_finalized_lender_vault().get_script_hash(),
            protocol_fee_vault_cov_hash: self.get_active_protocol_fee_vault().get_script_hash(),
            finalized_protocol_fee_vault_cov_hash: self
                .get_finalized_protocol_fee_vault()
                .get_script_hash(),
        }
    }

    fn get_lender_vault_finalized_parameters(&self) -> FinalizedAssetAuthVaultParameters {
        FinalizedAssetAuthVaultParameters {
            vault_asset_id: self.principal_asset_id,
            keeper_asset_id: self.lender_nft_asset_id,
            keeper_min_asset_amount: 1,
            with_keeper_asset_burn: true,
            supplier_asset_id: self.borrower_debt_nft_asset_id,
            with_supplier_asset_burn: true,
            network: self.network,
        }
    }

    fn get_protocol_fee_vault_finalized_parameters(&self) -> FinalizedAssetAuthVaultParameters {
        FinalizedAssetAuthVaultParameters {
            vault_asset_id: self.principal_asset_id,
            keeper_asset_id: self.protocol_fee_keeper_asset_id,
            keeper_min_asset_amount: 1,
            with_keeper_asset_burn: false,
            supplier_asset_id: self.borrower_debt_nft_asset_id,
            with_supplier_asset_burn: true,
            network: self.network,
        }
    }
}

#[cfg(test)]
mod tests {
    use simplex::{
        provider::SimplicityNetwork,
        simplicityhl::elements::{
            AssetId,
            bitcoin::secp256k1,
            hashes::sha256::Midstate,
            schnorr::{Keypair, XOnlyPublicKey},
        },
    };

    use crate::{
        programs::lending::{LendingParameters, params::LendingOfferRepaymentPhase},
        utils::get_random_seed,
    };

    fn get_random_asset_id() -> AssetId {
        let entropy = get_random_seed();

        AssetId::from_inner(Midstate::from_byte_array(entropy))
    }

    fn get_random_pubkey() -> XOnlyPublicKey {
        let keypair = Keypair::from_secret_key(
            secp256k1::SECP256K1,
            &secp256k1::SecretKey::from_slice(&[1u8; 32]).unwrap(),
        );

        keypair.x_only_public_key().0
    }

    fn dummy_lending_parameters(
        principal_amount: u64,
        principal_interest_rate: u16,
    ) -> LendingParameters {
        LendingParameters {
            collateral_asset_id: get_random_asset_id(),
            principal_asset_id: get_random_asset_id(),
            borrower_debt_nft_asset_id: get_random_asset_id(),
            lender_nft_asset_id: get_random_asset_id(),
            protocol_fee_keeper_asset_id: get_random_asset_id(),
            collateral_amount: 1_000_000,
            principal_amount,
            loan_expiration_time: 100_000,
            principal_interest_rate,
            borrower_pubkey: get_random_pubkey(),
            network: SimplicityNetwork::LiquidTestnet,
        }
    }

    #[test]
    fn get_total_fee_returns_correct_fee_amount() {
        let params = dummy_lending_parameters(1000, 500);

        assert_eq!(params.get_total_fee(), 50);

        let params = dummy_lending_parameters(1000, 0);

        assert_eq!(params.get_total_fee(), 0);

        let params = dummy_lending_parameters(1000, 10000);

        assert_eq!(params.get_total_fee(), 1000);
    }

    #[test]
    fn get_total_protocol_fee_returns_correct_fee_amount() {
        let params = dummy_lending_parameters(1000, 5000);

        assert_eq!(params.get_total_protocol_fee(), 50);

        let params = dummy_lending_parameters(1000, 0);

        assert_eq!(params.get_total_protocol_fee(), 0);

        let params = dummy_lending_parameters(1000, 10000);

        assert_eq!(params.get_total_protocol_fee(), 100);
    }

    #[test]
    fn get_total_amount_to_repay_returns_correct_amount() {
        let params = dummy_lending_parameters(1000, 500);

        assert_eq!(params.get_total_amount_to_repay(), 1050);

        let params = dummy_lending_parameters(1000, 0);

        assert_eq!(params.get_total_amount_to_repay(), 1000);

        let params = dummy_lending_parameters(1000, 10000);

        assert_eq!(params.get_total_amount_to_repay(), 2000);
    }

    #[test]
    fn get_repayment_phase_returns_correct_values() {
        let params = dummy_lending_parameters(1000, 500);

        let total_debt = 1050;

        assert_eq!(
            params.get_repayment_phase(total_debt),
            LendingOfferRepaymentPhase::NoRepayments
        );
        assert_eq!(
            params.get_repayment_phase(total_debt - 10),
            LendingOfferRepaymentPhase::RepayingOfferFee
        );
        assert_eq!(
            params.get_repayment_phase(total_debt - 100),
            LendingOfferRepaymentPhase::RepayingPrincipal
        );
        assert_eq!(
            params.get_repayment_phase(0),
            LendingOfferRepaymentPhase::Repaid
        );
    }

    #[test]
    fn get_already_repaid_amount_returns_correct_values() {
        let params = dummy_lending_parameters(1000, 500);

        let total_debt = 1050;

        assert_eq!(params.get_already_repaid_amount(total_debt), 0);

        let repaid_amount = 10;
        assert_eq!(
            params.get_already_repaid_amount(total_debt - repaid_amount),
            repaid_amount
        );

        let repaid_amount = 250;
        assert_eq!(
            params.get_already_repaid_amount(total_debt - repaid_amount),
            repaid_amount
        );

        assert_eq!(params.get_already_repaid_amount(0), total_debt);
    }

    #[test]
    fn get_fee_to_repay_returns_correct_values() {
        let params = dummy_lending_parameters(1000, 1000);

        let total_debt = 1100;
        let total_fee = 100;

        assert_eq!(params.get_fee_to_repay(total_debt), total_fee);

        let repaid_amount = 50;

        assert_eq!(
            params.get_fee_to_repay(total_debt - repaid_amount),
            total_fee - repaid_amount
        );

        let repaid_amount = 150;

        assert_eq!(params.get_fee_to_repay(total_debt - repaid_amount), 0);
    }

    #[test]
    fn get_protocol_fee_to_repay_returns_correct_values() {
        let params = dummy_lending_parameters(1000, 5000);

        let total_debt = 1500;
        let total_protocol_fee = 50;

        assert_eq!(
            params.get_protocol_fee_to_repay(total_debt),
            total_protocol_fee
        );

        let repaid_amount = 50;
        let repaid_protocol_fee_amount = 5;

        assert_eq!(
            params.get_protocol_fee_to_repay(total_debt - repaid_amount),
            total_protocol_fee - repaid_protocol_fee_amount
        );

        let repaid_amount = 150;
        let repaid_protocol_fee_amount = 15;

        assert_eq!(
            params.get_protocol_fee_to_repay(total_debt - repaid_amount),
            total_protocol_fee - repaid_protocol_fee_amount
        );

        let repaid_amount = 750;

        assert_eq!(
            params.get_protocol_fee_to_repay(total_debt - repaid_amount),
            0
        );
    }

    #[test]
    fn get_repaid_fee_returns_correct_values() {
        let params = dummy_lending_parameters(1000, 1000);

        let total_debt = 1100;
        let total_fee = 100;

        let amount_to_repay = 50;

        assert_eq!(
            params.get_repaid_fee(total_debt, amount_to_repay),
            amount_to_repay
        );

        let amount_to_repay = 150;

        assert_eq!(
            params.get_repaid_fee(total_debt, amount_to_repay),
            total_fee
        );

        let repaid_amount = 75;
        let amount_to_repay = 150;

        assert_eq!(
            params.get_repaid_fee(total_debt - repaid_amount, amount_to_repay),
            total_fee - repaid_amount
        );

        let repaid_amount = 150;
        let amount_to_repay = 150;

        assert_eq!(
            params.get_repaid_fee(total_debt - repaid_amount, amount_to_repay),
            0
        );
    }

    #[test]
    fn get_repaid_protocol_fee_returns_correct_values() {
        let params = dummy_lending_parameters(1000, 5000);

        let total_debt = 1500;
        let total_protocol_fee = 50;

        let amount_to_repay = 50;
        let repaid_protocol_fee_amount = 5;

        assert_eq!(
            params.get_repaid_protocol_fee(total_debt, amount_to_repay),
            repaid_protocol_fee_amount
        );

        let amount_to_repay = 1000;
        let repaid_protocol_fee_amount = total_protocol_fee;

        assert_eq!(
            params.get_repaid_protocol_fee(total_debt, amount_to_repay),
            repaid_protocol_fee_amount
        );

        let repaid_amount = 300;
        let amount_to_repay = 1000;
        let repaid_protocol_fee_amount = 20;

        assert_eq!(
            params.get_repaid_protocol_fee(total_debt - repaid_amount, amount_to_repay),
            repaid_protocol_fee_amount
        );

        let repaid_amount = 600;
        let amount_to_repay = 200;

        assert_eq!(
            params.get_repaid_protocol_fee(total_debt - repaid_amount, amount_to_repay),
            0
        );
    }
}
