use simplex::either::Either::{Left, Right};

use crate::artifacts::contracts::vault::lender_principal_vault::derived_lender_principal_vault::LenderPrincipalVaultWitness;

use crate::lender_principal_vault::LenderPrincipalVaultStorage;
use crate::utils::auth_transfer::AuthTransfer;

/// A spending path of the vault with the values it takes.
///
/// `vault_output_index` is where the recreated vault goes. A closing withdrawal that empties the
/// vault does not recreate it, and the index is not used.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LenderPrincipalVaultWitnessBranch {
    /// `finalize` marks the last supply, which burns the LendingOffer asset.
    Supply {
        vault_output_index: u32,
        lending_offer: AuthTransfer,
        amount_to_supply: u64,
        fee_to_supply: u64,
        finalize: bool,
    },
    PartialWithdrawal {
        vault_output_index: u32,
        lender_nft: AuthTransfer,
        amount_to_withdraw: u64,
    },
    FullWithdrawal {
        vault_output_index: u32,
        lender_nft: AuthTransfer,
    },
    LiquidationWithdrawal {
        vault_output_index: u32,
        lending_offer: AuthTransfer,
        lender_nft: AuthTransfer,
    },
    HarvesterWithdrawal {
        vault_output_index: u32,
        harvester_auth: AuthTransfer,
    },
}

impl LenderPrincipalVaultWitnessBranch {
    /// The witness that takes this path and reveals `storage`, the state of the spent vault.
    #[must_use]
    pub fn build_witness(
        &self,
        storage: &LenderPrincipalVaultStorage,
    ) -> LenderPrincipalVaultWitness {
        let path = match *self {
            Self::Supply {
                vault_output_index,
                lending_offer,
                amount_to_supply,
                fee_to_supply,
                finalize,
            } => {
                let params = (
                    vault_output_index,
                    lending_offer.input_index,
                    lending_offer.output_index,
                    amount_to_supply,
                    fee_to_supply,
                );

                if finalize {
                    Left(Right(params))
                } else {
                    Left(Left(params))
                }
            }
            Self::PartialWithdrawal {
                vault_output_index,
                lender_nft,
                amount_to_withdraw,
            } => Right(Left(Left((
                vault_output_index,
                lender_nft.input_index,
                lender_nft.output_index,
                amount_to_withdraw,
            )))),
            Self::FullWithdrawal {
                vault_output_index,
                lender_nft,
            } => Right(Left(Right((
                vault_output_index,
                lender_nft.input_index,
                lender_nft.output_index,
            )))),
            Self::LiquidationWithdrawal {
                vault_output_index,
                lending_offer,
                lender_nft,
            } => Right(Right(Left((
                vault_output_index,
                lending_offer.input_index,
                lending_offer.output_index,
                lender_nft.input_index,
                lender_nft.output_index,
            )))),
            Self::HarvesterWithdrawal {
                vault_output_index,
                harvester_auth,
            } => Right(Right(Right((
                vault_output_index,
                harvester_auth.input_index,
                harvester_auth.output_index,
            )))),
        };

        LenderPrincipalVaultWitness {
            is_finalized: storage.is_finalized,
            supplied_amount: storage.supplied_amount,
            supplied_fee: storage.supplied_fee,
            withdrawn_amount: storage.withdrawn_amount,
            withdrawn_protocol_fee: storage.withdrawn_protocol_fee,
            lender_asset_id: storage.lender_asset_id.to_byte_array(),
            lending_offer_asset_id: storage.lending_offer_asset_id.to_byte_array(),
            path,
        }
    }
}
