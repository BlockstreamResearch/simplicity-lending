use lending_contracts_v2::artifacts::tests::vault::accounting::AccountingProgram;
use lending_contracts_v2::artifacts::tests::vault::accounting::derived_accounting::{
    AccountingArguments, AccountingWitness,
};
use lending_contracts_v2::lender_principal_vault::LenderPrincipalVaultStorage;

use crate::support::case::DispatchCase;
use crate::vault::samples::{StorageTuple, fresh, from_tuple, tuple};

/// The functions of the test program.
#[derive(Clone, Copy)]
enum Function {
    AvailableLenderShares = 0,
    AvailableProtocolFee = 1,
}

const FUNCTIONS: u8 = 2;

#[derive(Clone, Debug)]
pub(super) struct Case {
    witness: AccountingWitness,
}

impl Case {
    fn new(
        function: Function,
        storage: StorageTuple,
        protocol_fee_rate: u64,
        expected: u64,
    ) -> Self {
        Self {
            witness: AccountingWitness {
                function_index: function as u8,
                storage,
                protocol_fee_rate,
                expected,
            },
        }
    }

    /// The same case under an index that selects no function.
    pub(super) fn unknown_function(mut self) -> Self {
        self.witness.function_index = FUNCTIONS;
        self
    }

    /// The same case expecting one more than it does.
    pub(super) fn off_by_one(mut self) -> Self {
        self.witness.expected = self.witness.expected.wrapping_add(1);
        self
    }

    /// Whether the SDK computes a result for the case.
    pub(super) fn sdk_accepts(&self) -> bool {
        reference(&mut self.witness.clone())
    }
}

impl DispatchCase for Case {
    type Program = AccountingProgram;

    fn program(&self) -> AccountingProgram {
        AccountingProgram::new(AccountingArguments::default())
    }

    fn witness(&self) -> AccountingWitness {
        self.witness.clone()
    }
}

/// Writes the SDK's result into the expected value of `witness`, and says whether the SDK computes
/// one.
pub(super) fn reference(witness: &mut AccountingWitness) -> bool {
    let storage = from_tuple(witness.storage);

    let result = if witness.function_index == Function::AvailableLenderShares as u8 {
        storage.available_lender_shares(witness.protocol_fee_rate)
    } else {
        storage.available_protocol_fee(witness.protocol_fee_rate)
    };

    if let Ok(expected) = result {
        witness.expected = expected;
    }

    result.is_ok()
}

/// A fresh vault after the given supplies and withdrawals.
pub(super) fn vault(
    supplied_amount: u64,
    supplied_fee: u64,
    withdrawn_amount: u64,
    withdrawn_protocol_fee: u64,
) -> LenderPrincipalVaultStorage {
    LenderPrincipalVaultStorage {
        supplied_amount,
        supplied_fee,
        withdrawn_amount,
        withdrawn_protocol_fee,
        ..fresh()
    }
}

// 0. available_lender_shares
pub(super) fn available_lender_shares(
    storage: StorageTuple,
    protocol_fee_rate: u64,
    expected: u64,
) -> Case {
    Case::new(
        Function::AvailableLenderShares,
        storage,
        protocol_fee_rate,
        expected,
    )
}

/// The expected value comes from the SDK, and stays 0 where the SDK fails.
pub(super) fn available_lender_shares_reference(
    storage: &LenderPrincipalVaultStorage,
    protocol_fee_rate: u64,
) -> Case {
    let mut case = available_lender_shares(tuple(storage), protocol_fee_rate, 0);
    reference(&mut case.witness);

    case
}

// 1. available_protocol_fee
pub(super) fn available_protocol_fee(
    storage: StorageTuple,
    protocol_fee_rate: u64,
    expected: u64,
) -> Case {
    Case::new(
        Function::AvailableProtocolFee,
        storage,
        protocol_fee_rate,
        expected,
    )
}

/// The expected value comes from the SDK, and stays 0 where the SDK fails.
pub(super) fn available_protocol_fee_reference(
    storage: &LenderPrincipalVaultStorage,
    protocol_fee_rate: u64,
) -> Case {
    let mut case = available_protocol_fee(tuple(storage), protocol_fee_rate, 0);
    reference(&mut case.witness);

    case
}
