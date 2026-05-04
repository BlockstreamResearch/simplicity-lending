use simplex::{
    program::Program,
    provider::SimplicityNetwork,
    transaction::{FinalTransaction, UTXO},
};

use crate::artifacts::asset_auth_vault::AssetAuthVaultProgram;
use crate::programs::asset_auth_vault::{AssetAuthVaultParameters, AssetAuthVaultWitnessBranch};
use crate::programs::program::SimplexProgram;

pub struct AssetAuthVault {
    program: AssetAuthVaultProgram,
    parameters: AssetAuthVaultParameters,
}

impl AssetAuthVault {
    pub fn new_active(parameters: AssetAuthVaultParameters) -> Self {
        let finalized_vault = Self::new_finalized(parameters);
        let finalized_vault_hash = finalized_vault.get_script_hash();

        let parameters = parameters.from_finalized_parameters(finalized_vault_hash);

        Self {
            program: AssetAuthVaultProgram::new(parameters.build_arguments()),
            parameters,
        }
    }

    pub fn new_finalized(parameters: AssetAuthVaultParameters) -> Self {
        assert!(
            parameters.is_finalized(),
            "Unable to create AssetAuthVault with non finalized parameters"
        );

        Self {
            program: AssetAuthVaultProgram::new(parameters.build_arguments()),
            parameters,
        }
    }

    pub fn get_parameters(&self) -> &AssetAuthVaultParameters {
        &self.parameters
    }

    pub fn attach_creation(&self, ft: &mut FinalTransaction, initial_asset_amount: u64) {
        self.add_program_output(ft, self.parameters.vault_asset_id, initial_asset_amount);
    }

    pub fn attach_withdrawing_all(
        &self,
        ft: &mut FinalTransaction,
        program_utxo: UTXO,
        input_keeper_index: u32,
        output_keeper_index: u32,
    ) {
        self.ensure_finalized_vault();

        let withdraw_all_witness_branch = AssetAuthVaultWitnessBranch::WithdrawAll {
            input_keeper_index,
            output_keeper_index,
        };

        self.add_program_input(
            ft,
            program_utxo,
            withdraw_all_witness_branch.build_witness(),
        );
    }

    pub fn attach_partial_withdrawing(
        &self,
        ft: &mut FinalTransaction,
        program_utxo: UTXO,
        input_keeper_index: u32,
        output_keeper_index: u32,
        amount_to_withdraw: u64,
    ) {
        self.ensure_non_finalized_vault();

        let current_vault_amount = program_utxo.explicit_amount();

        assert!(
            amount_to_withdraw < current_vault_amount,
            "Invalid amount to withdraw"
        );

        let vault_change = current_vault_amount - amount_to_withdraw;

        let vault_output_index = ft.n_outputs() as u32;

        let withdraw_part_witness_branch = AssetAuthVaultWitnessBranch::WithdrawPart {
            input_keeper_index,
            output_keeper_index,
            vault_output_index,
            amount_to_withdraw,
        };

        self.add_program_input(
            ft,
            program_utxo,
            withdraw_part_witness_branch.build_witness(),
        );

        self.add_program_output(ft, self.parameters.vault_asset_id, vault_change);
    }

    pub fn attach_supplying(
        &self,
        ft: &mut FinalTransaction,
        program_utxo: UTXO,
        input_supplier_index: u32,
        output_supplier_index: u32,
        amount_to_supply: u64,
    ) {
        self.ensure_non_finalized_vault();

        assert!(amount_to_supply > 0, "Zero amount to supply");

        let new_vault_amount = program_utxo.explicit_amount() + amount_to_supply;

        let vault_output_index = ft.n_outputs() as u32;

        let supply_witness_branch = AssetAuthVaultWitnessBranch::Supply {
            input_supplier_index,
            output_supplier_index,
            vault_output_index,
            amount_to_supply,
        };

        self.add_program_input(ft, program_utxo, supply_witness_branch.build_witness());

        self.add_program_output(ft, self.parameters.vault_asset_id, new_vault_amount);
    }

    pub fn attach_final_supplying(
        &self,
        ft: &mut FinalTransaction,
        program_utxo: UTXO,
        input_supplier_index: u32,
        output_supplier_index: u32,
        amount_to_supply: u64,
    ) -> AssetAuthVault {
        self.ensure_non_finalized_vault();

        assert!(amount_to_supply > 0, "Zero amount to supply");

        let new_vault_amount = program_utxo.explicit_amount() + amount_to_supply;

        let vault_output_index = ft.n_outputs() as u32;

        let supply_witness_branch = AssetAuthVaultWitnessBranch::FinalSupply {
            input_supplier_index,
            output_supplier_index,
            vault_output_index,
            amount_to_supply,
        };

        self.add_program_input(ft, program_utxo, supply_witness_branch.build_witness());

        let finalized_vault =
            AssetAuthVault::new_finalized(self.parameters.to_finalized_parameters());

        finalized_vault.add_program_output(ft, self.parameters.vault_asset_id, new_vault_amount);

        finalized_vault
    }

    fn ensure_finalized_vault(&self) {
        assert!(self.parameters.is_finalized(), "Not a finalized vault");
    }

    fn ensure_non_finalized_vault(&self) {
        assert!(
            !self.parameters.is_finalized(),
            "Vault is already finalized"
        );
    }
}

impl SimplexProgram for AssetAuthVault {
    fn get_program(&self) -> &Program {
        self.program.as_ref()
    }

    fn get_network(&self) -> &SimplicityNetwork {
        &self.parameters.network
    }
}
