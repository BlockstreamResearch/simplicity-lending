use simplex::{
    program::Program,
    provider::SimplicityNetwork,
    transaction::{FinalTransaction, UTXO},
};

use crate::artifacts::asset_auth_vault::AssetAuthVaultProgram;
use crate::programs::asset_auth_vault::{AssetAuthVaultParameters, AssetAuthVaultWitnessBranch};
use crate::programs::program::SimplexProgram;

pub struct AssetAuthVaultStorage {
    pub is_active: bool,
    pub already_supplied: u64,
}

impl AssetAuthVaultStorage {
    pub fn set_storage_slots(&self, program: &mut AssetAuthVaultProgram) {
        #[allow(unused_must_use)]
        program.set_storage_at(0, self.get_is_active_slot_value());
        #[allow(unused_must_use)]
        program.set_storage_at(1, self.get_already_supplied_slot_value());
    }

    fn get_is_active_slot_value(&self) -> [u8; 32] {
        let mut slot = [0u8; 32];
        slot[31] = u8::from(self.is_active);

        slot
    }

    fn get_already_supplied_slot_value(&self) -> [u8; 32] {
        let mut slot = [0u8; 32];
        slot[24..32].copy_from_slice(&self.already_supplied.to_be_bytes());

        slot
    }
}

pub struct AssetAuthVault {
    program: AssetAuthVaultProgram,
    parameters: AssetAuthVaultParameters,
    storage: AssetAuthVaultStorage,
}

impl AssetAuthVault {
    pub fn new_active(parameters: AssetAuthVaultParameters, already_supplied: u64) -> Self {
        assert!(
            already_supplied < parameters.supply_goal,
            "Already supplied amount can't be higher than the supply goal"
        );

        let storage = AssetAuthVaultStorage {
            is_active: true,
            already_supplied,
        };

        Self::new(parameters, storage)
    }

    pub fn new_finalized(parameters: AssetAuthVaultParameters) -> Self {
        let storage = AssetAuthVaultStorage {
            is_active: false,
            already_supplied: parameters.supply_goal,
        };

        Self::new(parameters, storage)
    }

    fn new(parameters: AssetAuthVaultParameters, storage: AssetAuthVaultStorage) -> Self {
        let mut asset_auth_vault_program =
            AssetAuthVaultProgram::new(&parameters.build_arguments()).with_storage_capacity(2);

        storage.set_storage_slots(&mut asset_auth_vault_program);

        Self {
            program: asset_auth_vault_program,
            parameters,
            storage,
        }
    }

    pub fn get_parameters(&self) -> &AssetAuthVaultParameters {
        &self.parameters
    }

    pub fn is_active_offer(&self) -> bool {
        self.storage.is_active
    }

    pub fn is_finalized_offer(&self) -> bool {
        !self.storage.is_active
    }

    pub fn get_already_supplied_amount(&self) -> u64 {
        self.storage.already_supplied
    }

    pub fn attach_creation(&self, ft: &mut FinalTransaction) {
        self.add_program_output(
            ft,
            self.parameters.vault_asset_id,
            self.storage.already_supplied,
        );
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
            already_supplied: self.get_already_supplied_amount(),
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

    pub fn attach_final_supplying(
        &mut self,
        ft: &mut FinalTransaction,
        program_utxo: UTXO,
        input_supplier_index: u32,
        output_supplier_index: u32,
    ) {
        let amount_to_goal = self.parameters.supply_goal - self.get_already_supplied_amount();

        self.attach_supplying(
            ft,
            program_utxo,
            input_supplier_index,
            output_supplier_index,
            amount_to_goal,
        );
    }

    pub fn attach_supplying(
        &mut self,
        ft: &mut FinalTransaction,
        program_utxo: UTXO,
        input_supplier_index: u32,
        output_supplier_index: u32,
        amount_to_supply: u64,
    ) {
        let already_supplied = self.get_already_supplied_amount();
        let amount_to_goal = self.parameters.supply_goal - already_supplied;
        let is_final_supply = amount_to_supply == amount_to_goal;

        let new_vault_amount = program_utxo.explicit_amount() + amount_to_supply;

        let vault_output_index = ft.n_outputs() as u32;

        let supply_witness_branch = if is_final_supply {
            AssetAuthVaultWitnessBranch::FinalSupply {
                input_supplier_index,
                output_supplier_index,
                vault_output_index,
                already_supplied,
            }
        } else {
            AssetAuthVaultWitnessBranch::Supply {
                input_supplier_index,
                output_supplier_index,
                vault_output_index,
                already_supplied,
                amount_to_supply,
            }
        };

        self.add_program_input(ft, program_utxo, supply_witness_branch.build_witness());

        self.update_vault_already_supplied(already_supplied + amount_to_supply);

        if is_final_supply {
            self.update_vault_status(false);
        }

        self.add_program_output(ft, self.parameters.vault_asset_id, new_vault_amount);
    }

    fn update_vault_status(&mut self, new_status: bool) {
        self.storage.is_active = new_status;
        self.storage.set_storage_slots(&mut self.program);
    }

    fn update_vault_already_supplied(&mut self, new_supplied_amount: u64) {
        self.storage.already_supplied = new_supplied_amount;
        self.storage.set_storage_slots(&mut self.program);
    }
}

impl SimplexProgram for AssetAuthVault {
    fn get_program_source_code() -> &'static str {
        AssetAuthVaultProgram::SOURCE
    }

    fn get_program(&self) -> &Program {
        self.program.as_ref()
    }

    fn get_network(&self) -> &SimplicityNetwork {
        &self.parameters.network
    }
}
