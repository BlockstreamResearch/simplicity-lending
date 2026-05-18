use simplex::{
    provider::SimplicityNetwork,
    simplicityhl::elements::{AssetId, schnorr::XOnlyPublicKey},
};

use crate::{
    artifacts::lending::derived_lending::LendingArguments,
    programs::{
        asset_auth::{AssetAuth, AssetAuthParameters},
        asset_auth_vault::{
            ActiveAssetAuthVault, FinalizedAssetAuthVault, FinalizedAssetAuthVaultParameters,
        },
        lending::{ActiveLendingOffer, OfferParameters},
        ownable_script_auth::{OwnableScriptAuth, OwnableScriptAuthParameters},
        program::SimplexProgram,
    },
};

#[derive(Debug, Clone, Copy)]
pub struct PendingLendingOfferParameters {
    pub collateral_asset_id: AssetId,
    pub principal_asset_id: AssetId,
    pub borrower_debt_nft_asset_id: AssetId,
    pub lender_nft_asset_id: AssetId,
    pub protocol_fee_keeper_asset_id: AssetId,
    pub active_lending_cov_hash: [u8; 32],
    pub offer_parameters: OfferParameters,
    pub borrower_pubkey: XOnlyPublicKey,
    pub network: SimplicityNetwork,
}

#[derive(Debug, Clone, Copy)]
pub struct ActiveLendingOfferParameters {
    pub collateral_asset_id: AssetId,
    pub principal_asset_id: AssetId,
    pub borrower_debt_nft_asset_id: AssetId,
    pub lender_nft_asset_id: AssetId,
    pub protocol_fee_keeper_asset_id: AssetId,
    pub offer_parameters: OfferParameters,
    pub borrower_pubkey: XOnlyPublicKey,
    pub network: SimplicityNetwork,
}

impl From<PendingLendingOfferParameters> for ActiveLendingOfferParameters {
    fn from(value: PendingLendingOfferParameters) -> Self {
        Self {
            collateral_asset_id: value.collateral_asset_id,
            principal_asset_id: value.principal_asset_id,
            borrower_debt_nft_asset_id: value.borrower_debt_nft_asset_id,
            lender_nft_asset_id: value.lender_nft_asset_id,
            protocol_fee_keeper_asset_id: value.protocol_fee_keeper_asset_id,
            offer_parameters: value.offer_parameters,
            borrower_pubkey: value.borrower_pubkey,
            network: value.network,
        }
    }
}

impl From<ActiveLendingOfferParameters> for PendingLendingOfferParameters {
    fn from(value: ActiveLendingOfferParameters) -> Self {
        let active_lending = ActiveLendingOffer::new(value);

        Self {
            collateral_asset_id: value.collateral_asset_id,
            principal_asset_id: value.principal_asset_id,
            borrower_debt_nft_asset_id: value.borrower_debt_nft_asset_id,
            lender_nft_asset_id: value.lender_nft_asset_id,
            protocol_fee_keeper_asset_id: value.protocol_fee_keeper_asset_id,
            active_lending_cov_hash: active_lending.get_script_hash(),
            offer_parameters: value.offer_parameters,
            borrower_pubkey: value.borrower_pubkey,
            network: value.network,
        }
    }
}

impl PendingLendingOfferParameters {
    pub fn get_borrower_debt_nft_script_auth(&self) -> OwnableScriptAuth {
        OwnableScriptAuth::new(OwnableScriptAuthParameters {
            owner_pubkey: self.borrower_pubkey,
            script_hash: self.active_lending_cov_hash,
            network: self.network,
        })
    }

    pub fn get_principal_output_asset_auth(&self) -> AssetAuth {
        AssetAuth::new(AssetAuthParameters {
            asset_id: self.borrower_debt_nft_asset_id,
            asset_amount: self.offer_parameters.get_total_amount_to_repay(),
            with_asset_burn: false,
            network: self.network,
        })
    }

    pub fn build_arguments(&self) -> LendingArguments {
        LendingArguments {
            collateral_asset_id: self.collateral_asset_id.into_inner().0,
            principal_asset_id: self.principal_asset_id.into_inner().0,
            borrower_debt_nft_asset_id: self.borrower_debt_nft_asset_id.into_inner().0,
            lender_nft_asset_id: self.lender_nft_asset_id.into_inner().0,
            collateral_amount: self.offer_parameters.collateral_amount,
            principal_amount: self.offer_parameters.principal_amount,
            principal_interest_rate: self.offer_parameters.principal_interest_rate as u64,
            loan_expiration_time: self.offer_parameters.loan_expiration_time,
            borrower_debt_nft_cov_hash: self.get_borrower_debt_nft_script_auth().get_script_hash(),
            principal_output_script_hash: self.get_principal_output_asset_auth().get_script_hash(),
            active_lending_offer_cov_hash: self.active_lending_cov_hash,
            borrower_pub_key: self.borrower_pubkey.serialize(),
            lender_vault_cov_hash: [0u8; 32],
            finalized_lender_vault_cov_hash: [0u8; 32],
            protocol_fee_vault_cov_hash: [0u8; 32],
            finalized_protocol_fee_vault_cov_hash: [0u8; 32],
            is_active: false,
        }
    }
}

impl ActiveLendingOfferParameters {
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
            collateral_amount: self.offer_parameters.collateral_amount,
            principal_amount: self.offer_parameters.principal_amount,
            principal_interest_rate: self.offer_parameters.principal_interest_rate as u64,
            loan_expiration_time: self.offer_parameters.loan_expiration_time,
            lender_vault_cov_hash: self.get_active_lender_vault().get_script_hash(),
            finalized_lender_vault_cov_hash: self.get_finalized_lender_vault().get_script_hash(),
            protocol_fee_vault_cov_hash: self.get_active_protocol_fee_vault().get_script_hash(),
            finalized_protocol_fee_vault_cov_hash: self
                .get_finalized_protocol_fee_vault()
                .get_script_hash(),
            borrower_debt_nft_cov_hash: [0u8; 32],
            principal_output_script_hash: [0u8; 32],
            active_lending_offer_cov_hash: [0u8; 32],
            borrower_pub_key: [0u8; 32],
            is_active: true,
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
