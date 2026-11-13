use lending_contracts_v2::artifacts::tests::utils::storage::StorageProgram;
use lending_contracts_v2::artifacts::tests::utils::storage::derived_storage::{
    StorageArguments, StorageWitness,
};

use crate::support::expect;

/// The functions of the test program, by the index it selects them with: the slot leaf of a value
/// of each type.
#[derive(Clone, Copy)]
enum Function {
    U256,
    Bool,
    U64,
}

const FUNCTIONS: u8 = 3;

/// The program holding `slot` in its only storage slot. It accepts a case when the slot leaf of the
/// claimed value gives the program's own script hash.
fn program(slot: [u8; 32]) -> StorageProgram {
    let mut program = StorageProgram::new(StorageArguments::default()).with_storage_capacity(1);
    program.set_storage_at(0, slot);

    program
}

fn case(function: Function) -> StorageWitness {
    StorageWitness {
        function_index: function as u8,
        u256_value: [0; 32],
        bool_value: false,
        u64_value: 0,
    }
}

fn u256_case(u256_value: [u8; 32]) -> StorageWitness {
    StorageWitness {
        u256_value,
        ..case(Function::U256)
    }
}

fn bool_case(bool_value: bool) -> StorageWitness {
    StorageWitness {
        bool_value,
        ..case(Function::Bool)
    }
}

fn u64_case(u64_value: u64) -> StorageWitness {
    StorageWitness {
        u64_value,
        ..case(Function::U64)
    }
}

/// A slot holding `value` as a 32-byte big-endian number.
fn u64_slot(value: u64) -> [u8; 32] {
    let mut slot = [0; 32];
    slot[24..].copy_from_slice(&value.to_be_bytes());

    slot
}

fn bool_slot(value: bool) -> [u8; 32] {
    u64_slot(u64::from(value))
}

#[test]
fn rejects_unknown_function() {
    expect::rejects(
        program([0; 32]).as_ref(),
        StorageWitness {
            function_index: FUNCTIONS,
            ..u256_case([0; 32])
        },
    );
}

#[test]
fn u256_slot_leaf_matches_storage() {
    let pattern: [u8; 32] = std::array::from_fn(|index| index as u8);

    for slot in [[0; 32], [0xff; 32], pattern] {
        let program = program(slot);

        expect::accepts(program.as_ref(), u256_case(slot));

        for byte in [0, 31] {
            let mut other = slot;
            other[byte] ^= 1;

            expect::rejects(program.as_ref(), u256_case(other));
        }
    }
}

#[test]
fn u64_slot_leaf_matches_storage() {
    for value in [0, 1, u64::MAX, 0x0102_0304_0506_0708] {
        let program = program(u64_slot(value));

        expect::accepts(program.as_ref(), u64_case(value));
        expect::rejects(program.as_ref(), u64_case(value ^ 1));
        expect::rejects(program.as_ref(), u64_case(value.swap_bytes() ^ 1));
    }
}

#[test]
fn u64_slot_leaf_takes_only_low_bytes_as_value() {
    let mut slot = u64_slot(7);
    slot[0] = 1;

    expect::rejects(program(slot).as_ref(), u64_case(7));
}

#[test]
fn bool_slot_leaf_matches_storage() {
    for value in [false, true] {
        let program = program(bool_slot(value));

        expect::accepts(program.as_ref(), bool_case(value));
        expect::rejects(program.as_ref(), bool_case(!value));
    }
}
