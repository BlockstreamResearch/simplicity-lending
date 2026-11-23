use lending_contracts_v2::artifacts::tests::utils::storage::StorageProgram;
use lending_contracts_v2::artifacts::tests::utils::storage::derived_storage::{
    StorageArguments, StorageWitness,
};

use crate::support::case::DispatchCase;
use crate::support::expect::Rejection::Assertion;

/// The functions of the test program, the slot leaf of a value of each type.
#[derive(Clone, Copy)]
enum Function {
    U256 = 0,
    Bool = 1,
    U64 = 2,
}

const FUNCTIONS: u8 = 3;

/// The program holds `slot` in its only storage slot, and the witness claims a value it holds. The
/// program accepts when the slot leaf of the claimed value gives its own script hash.
#[derive(Clone, Debug)]
struct Case {
    witness: StorageWitness,
    slot: [u8; 32],
}

impl Case {
    fn new(function: Function, slot: [u8; 32]) -> Self {
        Self {
            witness: StorageWitness {
                function_index: function as u8,
                u256_value: [0; 32],
                bool_value: false,
                u64_value: 0,
            },
            slot,
        }
    }

    /// The same case under an index that selects no function.
    fn unknown_function(mut self) -> Self {
        self.witness.function_index = FUNCTIONS;
        self
    }
}

impl DispatchCase for Case {
    type Program = StorageProgram;

    fn program(&self) -> StorageProgram {
        let mut program = StorageProgram::new(StorageArguments::default()).with_storage_capacity(1);
        program.set_storage_at(0, self.slot);

        program
    }

    fn witness(&self) -> StorageWitness {
        self.witness.clone()
    }
}

// 0. get_u256_slot_leaf
fn claim_u256(slot: [u8; 32], value: [u8; 32]) -> Case {
    let mut case = Case::new(Function::U256, slot);
    case.witness.u256_value = value;

    case
}

// 1. get_bool_slot_leaf
fn claim_bool(slot: [u8; 32], value: bool) -> Case {
    let mut case = Case::new(Function::Bool, slot);
    case.witness.bool_value = value;

    case
}

// 2. get_u64_slot_leaf
fn claim_u64(slot: [u8; 32], value: u64) -> Case {
    let mut case = Case::new(Function::U64, slot);
    case.witness.u64_value = value;

    case
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
    claim_u256([0; 32], [0; 32])
        .unknown_function()
        .rejects(Assertion);
}

// 0. get_u256_slot_leaf
#[test]
fn u256_slot_leaf_matches_storage() {
    let pattern: [u8; 32] = std::array::from_fn(|index| index as u8);

    for slot in [[0; 32], [0xff; 32], pattern] {
        claim_u256(slot, slot).accepts();

        for byte in [0, 31] {
            let mut other = slot;
            other[byte] ^= 1;

            claim_u256(slot, other).rejects(Assertion);
        }
    }
}

// 1. get_bool_slot_leaf
#[test]
fn bool_slot_leaf_matches_storage() {
    for value in [false, true] {
        claim_bool(bool_slot(value), value).accepts();
        claim_bool(bool_slot(value), !value).rejects(Assertion);
    }
}

// 2. get_u64_slot_leaf
#[test]
fn u64_slot_leaf_matches_storage() {
    for value in [0, 1, u64::MAX, 0x0102_0304_0506_0708] {
        let slot = u64_slot(value);

        claim_u64(slot, value).accepts();
        claim_u64(slot, value ^ 1).rejects(Assertion);
        claim_u64(slot, value.swap_bytes() ^ 1).rejects(Assertion);
    }
}

#[test]
fn u64_slot_leaf_takes_only_low_bytes_as_value() {
    let mut slot = u64_slot(7);
    slot[0] = 1;

    claim_u64(slot, 7).rejects(Assertion);
}
