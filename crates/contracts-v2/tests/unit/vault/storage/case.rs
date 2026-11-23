use lending_contracts_v2::artifacts::tests::vault::storage::StorageProgram;
use lending_contracts_v2::artifacts::tests::vault::storage::derived_storage::{
    StorageArguments, StorageWitness,
};
use lending_contracts_v2::lender_principal_vault::LenderPrincipalVaultStorage;

use crate::support::case::DispatchCase;
use crate::vault::samples::{StorageTuple, from_tuple, tuple};

/// The functions of the test program.
#[derive(Clone, Copy)]
enum Function {
    StorageHash = 0,
    CurrentStorage = 1,
    Getters = 2,
    WithSupply = 3,
    WithLenderWithdrawal = 4,
    WithProtocolFeeWithdrawal = 5,
}

const FUNCTIONS: u8 = 6;

#[derive(Clone, Debug)]
pub(super) struct Case {
    witness: StorageWitness,
    /// The storage the program holds, for the functions that read it.
    held: Option<LenderPrincipalVaultStorage>,
}

impl Case {
    fn new(function: Function, storage: StorageTuple) -> Self {
        Self {
            witness: StorageWitness {
                function_index: function as u8,
                storage,
                amount: 0,
                fee: 0,
                finalize: false,
                expected_hash: [0; 32],
                expected_storage: storage,
            },
            held: None,
        }
    }

    /// The same case under an index that selects no function.
    pub(super) fn unknown_function(mut self) -> Self {
        self.witness.function_index = FUNCTIONS;
        self
    }

    /// The same case with `storage` as the storage the function takes.
    pub(super) fn with_storage(mut self, storage: StorageTuple) -> Self {
        self.witness.storage = storage;
        self
    }

    pub(super) fn expect_hash(mut self, expected_hash: [u8; 32]) -> Self {
        self.witness.expected_hash = expected_hash;
        self
    }

    pub(super) fn expect_storage(mut self, expected_storage: StorageTuple) -> Self {
        self.witness.expected_storage = expected_storage;
        self
    }

    pub(super) fn expected_storage(&self) -> StorageTuple {
        self.witness.expected_storage
    }

    /// Whether the SDK computes a result for the case.
    pub(super) fn sdk_accepts(&self) -> bool {
        reference(&mut self.witness.clone())
    }
}

impl DispatchCase for Case {
    type Program = StorageProgram;

    /// The program holds the vault storage the way the vault does, when the case has one.
    fn program(&self) -> StorageProgram {
        let program = StorageProgram::new(StorageArguments::default());

        let Some(held) = self.held else {
            return program;
        };

        let mut program = program.with_storage_capacity(LenderPrincipalVaultStorage::SLOTS);

        for (index, slot) in held.slots().into_iter().enumerate() {
            program.set_storage_at(index, slot);
        }

        program
    }

    fn witness(&self) -> StorageWitness {
        self.witness.clone()
    }
}

/// Writes the SDK's result into the expected values of `witness`, and says whether the SDK computes
/// one. The functions without an expected value always do.
pub(super) fn reference(witness: &mut StorageWitness) -> bool {
    let storage = from_tuple(witness.storage);

    let next = match witness.function_index {
        index if index == Function::StorageHash as u8 => {
            witness.expected_hash = storage.storage_hash();

            return true;
        }
        index if index == Function::WithSupply as u8 => {
            storage.with_supply(witness.amount, witness.fee, witness.finalize)
        }
        index if index == Function::WithLenderWithdrawal as u8 => {
            storage.with_lender_withdrawal(witness.amount, witness.finalize)
        }
        index if index == Function::WithProtocolFeeWithdrawal as u8 => {
            storage.with_protocol_fee_withdrawal(witness.amount)
        }
        _ => return true,
    };

    if let Ok(next) = next {
        witness.expected_storage = tuple(&next);
    }

    next.is_ok()
}

/// `case` with its expected values from the SDK. They stay as they are where the SDK fails.
fn referenced(mut case: Case) -> Case {
    reference(&mut case.witness);

    case
}

// 0. storage_hash
pub(super) fn storage_hash(storage: StorageTuple, expected_hash: [u8; 32]) -> Case {
    Case::new(Function::StorageHash, storage).expect_hash(expected_hash)
}

pub(super) fn storage_hash_reference(storage: &LenderPrincipalVaultStorage) -> Case {
    referenced(storage_hash(tuple(storage), [0; 32]))
}

// 1. assert_storage_with_current
/// The program holds `held` and is told it holds the same.
pub(super) fn current_storage(held: &LenderPrincipalVaultStorage) -> Case {
    Case {
        held: Some(*held),
        ..Case::new(Function::CurrentStorage, tuple(held))
    }
}

// 2. getters
pub(super) fn getters(storage: &LenderPrincipalVaultStorage) -> Case {
    Case::new(Function::Getters, tuple(storage))
}

// 3. with_supply
pub(super) fn with_supply(
    storage: StorageTuple,
    amount_to_supply: u64,
    fee_to_supply: u64,
    finalize: bool,
) -> Case {
    let mut case = Case::new(Function::WithSupply, storage);
    case.witness.amount = amount_to_supply;
    case.witness.fee = fee_to_supply;
    case.witness.finalize = finalize;

    case
}

pub(super) fn with_supply_reference(
    storage: &LenderPrincipalVaultStorage,
    amount_to_supply: u64,
    fee_to_supply: u64,
    finalize: bool,
) -> Case {
    referenced(with_supply(
        tuple(storage),
        amount_to_supply,
        fee_to_supply,
        finalize,
    ))
}

// 4. with_lender_withdrawal
pub(super) fn with_lender_withdrawal(
    storage: StorageTuple,
    amount_to_withdraw: u64,
    finalize: bool,
) -> Case {
    let mut case = Case::new(Function::WithLenderWithdrawal, storage);
    case.witness.amount = amount_to_withdraw;
    case.witness.finalize = finalize;

    case
}

pub(super) fn with_lender_withdrawal_reference(
    storage: &LenderPrincipalVaultStorage,
    amount_to_withdraw: u64,
    finalize: bool,
) -> Case {
    referenced(with_lender_withdrawal(
        tuple(storage),
        amount_to_withdraw,
        finalize,
    ))
}

// 5. with_protocol_fee_withdrawal
pub(super) fn with_protocol_fee_withdrawal(
    storage: StorageTuple,
    protocol_fee_to_withdraw: u64,
) -> Case {
    let mut case = Case::new(Function::WithProtocolFeeWithdrawal, storage);
    case.witness.amount = protocol_fee_to_withdraw;

    case
}

pub(super) fn with_protocol_fee_withdrawal_reference(
    storage: &LenderPrincipalVaultStorage,
    protocol_fee_to_withdraw: u64,
) -> Case {
    referenced(with_protocol_fee_withdrawal(
        tuple(storage),
        protocol_fee_to_withdraw,
    ))
}
