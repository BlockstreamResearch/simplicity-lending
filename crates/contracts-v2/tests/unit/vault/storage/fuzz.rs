use simplex::fuzz::proptest::prelude::any;
use simplex::{FuzzMode, TestContext};

use crate::support::fuzz;
use crate::vault::samples::storages;

use super::case;

// 0. storage_hash
#[simplex::fuzz]
fn fuzz_unit_vault_storage_hash(context: TestContext<FuzzMode>) {
    fuzz::run(
        &context,
        (storages(), any::<[u8; 32]>()),
        |(storage, expected_hash)| case::storage_hash(storage, expected_hash),
        case::reference,
    );
}

// 3. with_supply
#[simplex::fuzz]
fn fuzz_unit_vault_with_supply(context: TestContext<FuzzMode>) {
    fuzz::run(
        &context,
        (storages(), fuzz::amounts(), fuzz::amounts(), any::<bool>()),
        |(storage, amount_to_supply, fee_to_supply, finalize)| {
            case::with_supply(storage, amount_to_supply, fee_to_supply, finalize)
        },
        case::reference,
    );
}

// 4. with_lender_withdrawal
#[simplex::fuzz]
fn fuzz_unit_vault_with_lender_withdrawal(context: TestContext<FuzzMode>) {
    fuzz::run(
        &context,
        (storages(), fuzz::amounts(), any::<bool>()),
        |(storage, amount_to_withdraw, finalize)| {
            case::with_lender_withdrawal(storage, amount_to_withdraw, finalize)
        },
        case::reference,
    );
}

// 5. with_protocol_fee_withdrawal
#[simplex::fuzz]
fn fuzz_unit_vault_with_protocol_fee_withdrawal(context: TestContext<FuzzMode>) {
    fuzz::run(
        &context,
        (storages(), fuzz::amounts()),
        |(storage, protocol_fee_to_withdraw)| {
            case::with_protocol_fee_withdrawal(storage, protocol_fee_to_withdraw)
        },
        case::reference,
    );
}
