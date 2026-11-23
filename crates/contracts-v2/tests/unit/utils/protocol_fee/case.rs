use lending_contracts_v2::artifacts::tests::utils::protocol_fee::ProtocolFeeProgram;
use lending_contracts_v2::artifacts::tests::utils::protocol_fee::derived_protocol_fee::{
    ProtocolFeeArguments, ProtocolFeeWitness,
};
use lending_contracts_v2::utils::protocol_fee::{
    FEE_RATE_DENOMINATOR, protocol_fee_part as sdk_protocol_fee_part,
};

use crate::support::case::DispatchCase;

/// The functions of the test program.
#[derive(Clone, Copy)]
enum Function {
    ProtocolFeePart = 0,
    FeeRateDenominator = 1,
}

const FUNCTIONS: u8 = 2;

#[derive(Clone, Debug)]
pub(super) struct Case {
    witness: ProtocolFeeWitness,
}

impl Case {
    fn new(function: Function) -> Self {
        Self {
            witness: ProtocolFeeWitness {
                function_index: function as u8,
                fee_amount: 0,
                fee_rate: 0,
                expected: 0,
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
    type Program = ProtocolFeeProgram;

    fn program(&self) -> ProtocolFeeProgram {
        ProtocolFeeProgram::new(ProtocolFeeArguments::default())
    }

    fn witness(&self) -> ProtocolFeeWitness {
        self.witness.clone()
    }
}

/// Writes the SDK's result into the expected value of `witness`, and says whether the SDK computes
/// one.
pub(super) fn reference(witness: &mut ProtocolFeeWitness) -> bool {
    let expected = if witness.function_index == Function::ProtocolFeePart as u8 {
        sdk_protocol_fee_part(witness.fee_amount, witness.fee_rate)
    } else {
        Some(FEE_RATE_DENOMINATOR)
    };

    if let Some(expected) = expected {
        witness.expected = expected;
    }

    expected.is_some()
}

// 0. get_protocol_fee_part
pub(super) fn protocol_fee_part(fee_amount: u64, fee_rate: u64, expected: u64) -> Case {
    let mut case = Case::new(Function::ProtocolFeePart);
    case.witness.fee_amount = fee_amount;
    case.witness.fee_rate = fee_rate;
    case.witness.expected = expected;

    case
}

/// The expected value comes from the SDK, and stays 0 where the SDK overflows.
pub(super) fn protocol_fee_part_reference(fee_amount: u64, fee_rate: u64) -> Case {
    let mut case = protocol_fee_part(fee_amount, fee_rate, 0);
    reference(&mut case.witness);

    case
}

// 1. fee_rate_denominator
pub(super) fn fee_rate_denominator(expected: u64) -> Case {
    let mut case = Case::new(Function::FeeRateDenominator);
    case.witness.expected = expected;

    case
}
