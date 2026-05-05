use simplex::{
    program::Program,
    provider::SimplicityNetwork,
    transaction::{FinalTransaction, UTXO},
};

use crate::artifacts::asset_auth_vault::AssetAuthVaultProgram;
use crate::programs::asset_auth_vault::{
    ActiveAssetAuthVaultParameters, AssetAuthVaultWitnessBranch, FinalizedAssetAuthVaultParameters,
};
use crate::programs::program::SimplexProgram;

pub struct ActiveAssetAuthVault {
    program: AssetAuthVaultProgram,
    parameters: ActiveAssetAuthVaultParameters,
}

pub struct FinalizedAssetAuthVault {
    program: AssetAuthVaultProgram,
    parameters: FinalizedAssetAuthVaultParameters,
}

impl ActiveAssetAuthVault {
    pub fn new(parameters: ActiveAssetAuthVaultParameters) -> Self {
        Self {
            program: AssetAuthVaultProgram::new(parameters.build_arguments()),
            parameters,
        }
    }

    pub fn from_finalized_vault(parameters: FinalizedAssetAuthVaultParameters) -> Self {
        let finalized_vault = FinalizedAssetAuthVault::new(parameters);
        let finalized_vault_hash = finalized_vault.get_script_hash();

        let active_vault_parameters = ActiveAssetAuthVaultParameters::from_finalized_parameters(
            &parameters,
            finalized_vault_hash,
        );

        Self::new(active_vault_parameters)
    }

    pub fn get_parameters(&self) -> &ActiveAssetAuthVaultParameters {
        &self.parameters
    }

    pub fn attach_creation(&self, ft: &mut FinalTransaction, vault_asset_amount: u64) {
        self.add_program_output(ft, self.parameters.vault_asset_id, vault_asset_amount);
    }

    pub fn attach_partial_withdrawing(
        &self,
        ft: &mut FinalTransaction,
        program_utxo: UTXO,
        input_keeper_index: u32,
        output_keeper_index: u32,
        amount_to_withdraw: u64,
    ) {
        let current_vault_amount = program_utxo.explicit_amount();

        assert!(
            amount_to_withdraw < current_vault_amount,
            "Invalid amount to withdraw"
        );

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

        self.add_program_output(
            ft,
            self.parameters.vault_asset_id,
            current_vault_amount - amount_to_withdraw,
        );
    }

    pub fn attach_supplying(
        &self,
        ft: &mut FinalTransaction,
        program_utxo: UTXO,
        input_supplier_index: u32,
        output_supplier_index: u32,
        amount_to_supply: u64,
    ) {
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
    ) -> FinalizedAssetAuthVault {
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

        let finalized_vault = FinalizedAssetAuthVault::new(self.parameters.into());

        finalized_vault.attach_creation(ft, new_vault_amount);

        finalized_vault
    }
}

impl FinalizedAssetAuthVault {
    pub fn new(parameters: FinalizedAssetAuthVaultParameters) -> Self {
        Self {
            program: AssetAuthVaultProgram::new(parameters.build_arguments()),
            parameters,
        }
    }

    pub fn get_parameters(&self) -> &FinalizedAssetAuthVaultParameters {
        &self.parameters
    }

    pub fn attach_creation(&self, ft: &mut FinalTransaction, vault_asset_amount: u64) {
        self.add_program_output(ft, self.parameters.vault_asset_id, vault_asset_amount);
    }

    pub fn attach_withdrawing_all(
        &self,
        ft: &mut FinalTransaction,
        program_utxo: UTXO,
        input_keeper_index: u32,
        output_keeper_index: u32,
    ) {
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
}

impl SimplexProgram for ActiveAssetAuthVault {
    fn get_program(&self) -> &Program {
        self.program.as_ref()
    }

    fn get_network(&self) -> &SimplicityNetwork {
        &self.parameters.network
    }
}

impl SimplexProgram for FinalizedAssetAuthVault {
    fn get_program(&self) -> &Program {
        self.program.as_ref()
    }

    fn get_network(&self) -> &SimplicityNetwork {
        &self.parameters.network
    }
}
