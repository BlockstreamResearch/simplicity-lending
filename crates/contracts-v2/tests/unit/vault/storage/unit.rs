use lending_contracts_v2::lender_principal_vault::LenderPrincipalVaultStorage;

use crate::support::case::DispatchCase;
use crate::support::expect::Rejection::{Assertion, PrunedBranch};
use crate::vault::samples::{distinct, each_field_changed, fresh, from_tuple, saturated, tuple};

use super::case::{self, Case};

/// The program accepts the SDK's storage after the transition, and rejects it with any field
/// changed.
#[track_caller]
fn assert_transition_matches_sdk(case: Case) {
    assert!(case.sdk_accepts());

    case.accepts();

    for other in each_field_changed(&from_tuple(case.expected_storage())) {
        case.clone().expect_storage(other).rejects(Assertion);
    }
}

/// The SDK fails on the transition, and the program rejects it on the overflow.
#[track_caller]
fn assert_transition_overflows(case: Case) {
    assert!(!case.sdk_accepts());

    case.rejects(PrunedBranch);
}

#[test]
fn rejects_unknown_function() {
    case::getters(&distinct())
        .unknown_function()
        .rejects(Assertion);
}

// 0. storage_hash
#[test]
fn storage_hash_matches_sdk() {
    for storage in [fresh(), distinct(), saturated()] {
        let mut other = storage.storage_hash();
        other[0] ^= 1;

        case::storage_hash_reference(&storage).accepts();
        case::storage_hash_reference(&storage)
            .expect_hash(other)
            .rejects(Assertion);
    }
}

#[test]
fn storage_hash_covers_every_field() {
    let storage = distinct();

    for other in each_field_changed(&storage) {
        case::storage_hash_reference(&storage)
            .with_storage(other)
            .rejects(Assertion);
    }
}

// 1. assert_storage_with_current
/// The SDK's storage slots give the script the program checks the claimed storage against.
#[test]
fn current_storage_matches_sdk_slots() {
    for storage in [fresh(), distinct(), saturated()] {
        case::current_storage(&storage).accepts();

        for other in each_field_changed(&storage) {
            case::current_storage(&storage)
                .with_storage(other)
                .rejects(Assertion);
        }
    }
}

// 2. getters
#[test]
fn getters_return_their_fields() {
    case::getters(&distinct()).accepts();
}

// 3. with_supply
#[test]
fn with_supply_matches_sdk() {
    for (storage, amount_to_supply, fee_to_supply, finalize) in [
        (fresh(), 1_000, 100, false),
        (fresh(), 1_000, 0, true),
        // The flag follows `finalize`, whatever it was
        (distinct(), 5, 3, false),
        (distinct(), 0, 0, true),
        // The totals reach the top of u64
        (
            LenderPrincipalVaultStorage {
                supplied_amount: u64::MAX - 1,
                supplied_fee: u64::MAX - 1,
                ..distinct()
            },
            1,
            1,
            false,
        ),
    ] {
        assert_transition_matches_sdk(case::with_supply_reference(
            &storage,
            amount_to_supply,
            fee_to_supply,
            finalize,
        ));
    }
}

#[test]
fn with_supply_rejects_overflow() {
    let storage = tuple(&LenderPrincipalVaultStorage {
        supplied_amount: u64::MAX,
        supplied_fee: u64::MAX,
        ..fresh()
    });

    assert_transition_overflows(case::with_supply(storage, 1, 0, false));
    assert_transition_overflows(case::with_supply(storage, 0, 1, false));
}

// 4. with_lender_withdrawal
#[test]
fn with_lender_withdrawal_matches_sdk() {
    for (storage, amount_to_withdraw, finalize) in [
        (fresh(), 0, false),
        (distinct(), 7, false),
        (distinct(), 7, true),
        (
            LenderPrincipalVaultStorage {
                withdrawn_amount: u64::MAX - 1,
                ..fresh()
            },
            1,
            true,
        ),
    ] {
        assert_transition_matches_sdk(case::with_lender_withdrawal_reference(
            &storage,
            amount_to_withdraw,
            finalize,
        ));
    }
}

#[test]
fn with_lender_withdrawal_rejects_overflow() {
    let storage = tuple(&LenderPrincipalVaultStorage {
        withdrawn_amount: u64::MAX,
        ..fresh()
    });

    assert_transition_overflows(case::with_lender_withdrawal(storage, 1, true));
}

// 5. with_protocol_fee_withdrawal
#[test]
fn with_protocol_fee_withdrawal_matches_sdk() {
    for (storage, protocol_fee_to_withdraw) in [
        (fresh(), 0),
        // Keeps the vault finalized
        (distinct(), 9),
        (
            LenderPrincipalVaultStorage {
                withdrawn_protocol_fee: u64::MAX - 1,
                ..fresh()
            },
            1,
        ),
    ] {
        assert_transition_matches_sdk(case::with_protocol_fee_withdrawal_reference(
            &storage,
            protocol_fee_to_withdraw,
        ));
    }
}

#[test]
fn with_protocol_fee_withdrawal_rejects_overflow() {
    let storage = tuple(&LenderPrincipalVaultStorage {
        withdrawn_protocol_fee: u64::MAX,
        ..fresh()
    });

    assert_transition_overflows(case::with_protocol_fee_withdrawal(storage, 1));
}
