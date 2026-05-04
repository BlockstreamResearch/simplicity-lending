use simplex::either::Either::{Left, Right};

use crate::artifacts::asset_auth_vault::derived_asset_auth_vault::AssetAuthVaultWitness;

#[derive(Debug, Clone, Copy)]
pub enum AssetAuthVaultWitnessBranch {
    WithdrawAll {
        input_keeper_index: u32,
        output_keeper_index: u32,
    },
    WithdrawPart {
        input_keeper_index: u32,
        output_keeper_index: u32,
        vault_output_index: u32,
        amount_to_withdraw: u64,
    },
    Supply {
        input_supplier_index: u32,
        output_supplier_index: u32,
        vault_output_index: u32,
        amount_to_supply: u64,
    },
    FinalSupply {
        input_supplier_index: u32,
        output_supplier_index: u32,
        vault_output_index: u32,
        amount_to_supply: u64,
    },
}

impl AssetAuthVaultWitnessBranch {
    pub fn build_witness(&self) -> Box<AssetAuthVaultWitness> {
        let path = match self {
            AssetAuthVaultWitnessBranch::WithdrawAll {
                input_keeper_index,
                output_keeper_index,
            } => Left(Left((*input_keeper_index, *output_keeper_index))),
            AssetAuthVaultWitnessBranch::WithdrawPart {
                input_keeper_index,
                output_keeper_index,
                vault_output_index,
                amount_to_withdraw,
            } => Left(Right((
                *input_keeper_index,
                *output_keeper_index,
                *vault_output_index,
                *amount_to_withdraw,
            ))),
            AssetAuthVaultWitnessBranch::Supply {
                input_supplier_index,
                output_supplier_index,
                vault_output_index,
                amount_to_supply,
            } => Right(Left((
                *input_supplier_index,
                *output_supplier_index,
                *vault_output_index,
                *amount_to_supply,
            ))),
            AssetAuthVaultWitnessBranch::FinalSupply {
                input_supplier_index,
                output_supplier_index,
                vault_output_index,
                amount_to_supply,
            } => Right(Right((
                *input_supplier_index,
                *output_supplier_index,
                *vault_output_index,
                *amount_to_supply,
            ))),
        };

        Box::new(AssetAuthVaultWitness { path })
    }
}
