use simplex::fuzz::proptest::prelude::{Strategy, any};
use simplex::{FuzzMode, TestContext};

use lending_contracts_v2::artifacts::tests::vault::storage::StorageProgram;
use lending_contracts_v2::artifacts::tests::vault::storage::derived_storage::{
    StorageArguments, StorageWitness,
};
use lending_contracts_v2::lender_principal_vault::LenderPrincipalVaultStorage;

use super::cases::{
    StorageTuple, distinct, each_field_changed, fresh, from_tuple, saturated, storages, tuple,
};
use crate::support::{expect, fuzz};

/// The functions of the test program, by the index it selects them with.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Function {
    StorageHash,
    CurrentStorage,
    Getters,
    WithSupply,
    WithLenderWithdrawal,
    WithProtocolFeeWithdrawal,
}

const FUNCTIONS: u8 = 6;

fn program() -> StorageProgram {
    StorageProgram::new(StorageArguments::default())
}

/// The program holding `storage` the way the vault does.
fn program_holding(storage: &LenderPrincipalVaultStorage) -> StorageProgram {
    let mut program = program().with_storage_capacity(LenderPrincipalVaultStorage::SLOTS);

    for (index, slot) in storage.slots().into_iter().enumerate() {
        program.set_storage_at(index, slot);
    }

    program
}

fn case(function: Function, storage: &LenderPrincipalVaultStorage) -> StorageWitness {
    StorageWitness {
        function_index: function as u8,
        storage: tuple(storage),
        amount: 0,
        fee: 0,
        finalize: false,
        expected_hash: [0; 32],
        expected_storage: tuple(storage),
    }
}

fn storage_hash_case(storage: &LenderPrincipalVaultStorage, expected: [u8; 32]) -> StorageWitness {
    StorageWitness {
        expected_hash: expected,
        ..case(Function::StorageHash, storage)
    }
}

fn with_supply_case(
    storage: &LenderPrincipalVaultStorage,
    amount_to_supply: u64,
    fee_to_supply: u64,
    finalize: bool,
) -> StorageWitness {
    StorageWitness {
        amount: amount_to_supply,
        fee: fee_to_supply,
        finalize,
        ..case(Function::WithSupply, storage)
    }
}

fn with_lender_withdrawal_case(
    storage: &LenderPrincipalVaultStorage,
    amount_to_withdraw: u64,
    finalize: bool,
) -> StorageWitness {
    StorageWitness {
        amount: amount_to_withdraw,
        finalize,
        ..case(Function::WithLenderWithdrawal, storage)
    }
}

fn with_protocol_fee_withdrawal_case(
    storage: &LenderPrincipalVaultStorage,
    protocol_fee_to_withdraw: u64,
) -> StorageWitness {
    StorageWitness {
        amount: protocol_fee_to_withdraw,
        ..case(Function::WithProtocolFeeWithdrawal, storage)
    }
}

/// The storage the SDK moves to on the transition `witness` selects, `None` where it fails.
fn next_storage(witness: &StorageWitness) -> Option<StorageTuple> {
    let storage = from_tuple(witness.storage);

    let next = match witness.function_index {
        index if index == Function::WithSupply as u8 => {
            storage.with_supply(witness.amount, witness.fee, witness.finalize)
        }
        index if index == Function::WithLenderWithdrawal as u8 => {
            storage.with_lender_withdrawal(witness.amount, witness.finalize)
        }
        index if index == Function::WithProtocolFeeWithdrawal as u8 => {
            storage.with_protocol_fee_withdrawal(witness.amount)
        }
        index => unreachable!("function {index} is not a transition"),
    };

    next.ok().map(|next| tuple(&next))
}

/// The program accepts the SDK's storage after each transition, and rejects it with any field
/// changed.
#[track_caller]
fn assert_transitions_match_sdk(cases: &[StorageWitness]) {
    let program = program();

    for witness in cases {
        let expected = next_storage(witness).expect("the transition fits u64");

        expect::accepts(
            program.as_ref(),
            StorageWitness {
                expected_storage: expected,
                ..witness.clone()
            },
        );

        for other in each_field_changed(&from_tuple(expected)) {
            expect::rejects(
                program.as_ref(),
                StorageWitness {
                    expected_storage: other,
                    ..witness.clone()
                },
            );
        }
    }
}

/// The SDK fails on each transition and the program rejects it.
#[track_caller]
fn assert_transitions_reject(cases: &[StorageWitness]) {
    let program = program();

    for witness in cases {
        assert_eq!(next_storage(witness), None);

        expect::rejects(program.as_ref(), witness.clone());
    }
}

#[test]
fn rejects_unknown_function() {
    expect::rejects(
        program().as_ref(),
        StorageWitness {
            function_index: FUNCTIONS,
            ..case(Function::Getters, &distinct())
        },
    );
}

#[test]
fn storage_hash_matches_sdk() {
    let program = program();

    for storage in [fresh(), distinct(), saturated()] {
        let expected = storage.storage_hash();
        let mut other = expected;
        other[0] ^= 1;

        expect::accepts(program.as_ref(), storage_hash_case(&storage, expected));
        expect::rejects(program.as_ref(), storage_hash_case(&storage, other));
    }
}

#[test]
fn storage_hash_covers_every_field() {
    let program = program();
    let storage = distinct();

    for other in each_field_changed(&storage) {
        expect::rejects(
            program.as_ref(),
            StorageWitness {
                storage: other,
                ..storage_hash_case(&storage, storage.storage_hash())
            },
        );
    }
}

/// The SDK's storage slots give the script the program checks the claimed storage against.
#[test]
fn current_storage_matches_sdk_slots() {
    for storage in [fresh(), distinct(), saturated()] {
        let program = program_holding(&storage);

        expect::accepts(program.as_ref(), case(Function::CurrentStorage, &storage));

        for other in each_field_changed(&storage) {
            expect::rejects(
                program.as_ref(),
                StorageWitness {
                    storage: other,
                    ..case(Function::CurrentStorage, &storage)
                },
            );
        }
    }
}

#[test]
fn getters_return_their_fields() {
    expect::accepts(program().as_ref(), case(Function::Getters, &distinct()));
}

#[test]
fn with_supply_matches_sdk() {
    assert_transitions_match_sdk(&[
        with_supply_case(&fresh(), 1_000, 100, false),
        with_supply_case(&fresh(), 1_000, 0, true),
        // The flag follows `finalize`, whatever it was
        with_supply_case(&distinct(), 5, 3, false),
        with_supply_case(&distinct(), 0, 0, true),
        // The totals reach the top of u64
        with_supply_case(
            &LenderPrincipalVaultStorage {
                supplied_amount: u64::MAX - 1,
                supplied_fee: u64::MAX - 1,
                ..distinct()
            },
            1,
            1,
            false,
        ),
    ]);
}

#[test]
fn with_supply_rejects_overflow() {
    let storage = LenderPrincipalVaultStorage {
        supplied_amount: u64::MAX,
        supplied_fee: u64::MAX,
        ..fresh()
    };

    assert_transitions_reject(&[
        with_supply_case(&storage, 1, 0, false),
        with_supply_case(&storage, 0, 1, false),
    ]);
}

#[test]
fn with_lender_withdrawal_matches_sdk() {
    assert_transitions_match_sdk(&[
        with_lender_withdrawal_case(&fresh(), 0, false),
        with_lender_withdrawal_case(&distinct(), 7, false),
        with_lender_withdrawal_case(&distinct(), 7, true),
        with_lender_withdrawal_case(
            &LenderPrincipalVaultStorage {
                withdrawn_amount: u64::MAX - 1,
                ..fresh()
            },
            1,
            true,
        ),
    ]);
}

#[test]
fn with_lender_withdrawal_rejects_overflow() {
    let storage = LenderPrincipalVaultStorage {
        withdrawn_amount: u64::MAX,
        ..fresh()
    };

    assert_transitions_reject(&[with_lender_withdrawal_case(&storage, 1, true)]);
}

#[test]
fn with_protocol_fee_withdrawal_matches_sdk() {
    assert_transitions_match_sdk(&[
        with_protocol_fee_withdrawal_case(&fresh(), 0),
        // Keeps the vault finalized
        with_protocol_fee_withdrawal_case(&distinct(), 9),
        with_protocol_fee_withdrawal_case(
            &LenderPrincipalVaultStorage {
                withdrawn_protocol_fee: u64::MAX - 1,
                ..fresh()
            },
            1,
        ),
    ]);
}

#[test]
fn with_protocol_fee_withdrawal_rejects_overflow() {
    let storage = LenderPrincipalVaultStorage {
        withdrawn_protocol_fee: u64::MAX,
        ..fresh()
    };

    assert_transitions_reject(&[with_protocol_fee_withdrawal_case(&storage, 1)]);
}

/// Cases of `function` with every witness value generated, those it doesn't take included.
fn cases(function: Function) -> impl Strategy<Value = StorageWitness> {
    (
        storages(),
        fuzz::amounts(),
        fuzz::amounts(),
        any::<bool>(),
        any::<[u8; 32]>(),
        storages(),
    )
        .prop_map(
            move |(storage, amount, fee, finalize, expected_hash, expected_storage)| {
                StorageWitness {
                    function_index: function as u8,
                    storage,
                    amount,
                    fee,
                    finalize,
                    expected_hash,
                    expected_storage,
                }
            },
        )
}

#[simplex::fuzz]
fn fuzz_unit_vault_storage_hash(context: TestContext<FuzzMode>) {
    fuzz::run(
        &context,
        &program(),
        case(Function::StorageHash, &fresh()),
        cases(Function::StorageHash),
        |witness| witness.expected_hash = from_tuple(witness.storage).storage_hash(),
        |_| true,
    );
}

/// Fuzzes the transition `function` against the SDK.
fn fuzz_transition(context: &TestContext<FuzzMode>, function: Function) {
    fuzz::run(
        context,
        &program(),
        case(function, &fresh()),
        cases(function),
        |witness| {
            if let Some(expected) = next_storage(witness) {
                witness.expected_storage = expected;
            }
        },
        |witness| next_storage(witness).is_some(),
    );
}

#[simplex::fuzz]
fn fuzz_unit_vault_with_supply(context: TestContext<FuzzMode>) {
    fuzz_transition(&context, Function::WithSupply);
}

#[simplex::fuzz]
fn fuzz_unit_vault_with_lender_withdrawal(context: TestContext<FuzzMode>) {
    fuzz_transition(&context, Function::WithLenderWithdrawal);
}

#[simplex::fuzz]
fn fuzz_unit_vault_with_protocol_fee_withdrawal(context: TestContext<FuzzMode>) {
    fuzz_transition(&context, Function::WithProtocolFeeWithdrawal);
}
