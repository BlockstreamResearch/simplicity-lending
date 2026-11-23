use std::fmt::Debug;

use simplex::fuzz::proptest::prelude::{Just, Strategy, any, prop_oneof};
use simplex::fuzz::proptest::strategy::ValueTree;
use simplex::fuzz::proptest::test_runner::TestRunner;
use simplex::fuzz::{Expect, FuzzProgramValues, Scenario};
use simplex::program::ProgramSchema;
use simplex::{FuzzMode, TestContext};

use lending_contracts_v2::utils::protocol_fee::FEE_RATE_DENOMINATOR;

use crate::support::case::{DispatchCase, WitnessOf};
use crate::support::execution;

/// The name of the program in [`run`] scenarios.
const FUZZED: &str = "unit";

/// Fuzzes the cases `build` makes from `inputs`, against a model.
///
/// `reference` writes the model's result into the expected values of a witness and says whether the
/// program must accept it. The program must reject any other expected value.
///
/// Only for programs that take no arguments and read no storage.
pub fn run<C, T>(
    context: &TestContext<FuzzMode>,
    inputs: impl Strategy<Value = T> + 'static,
    build: impl Fn(T) -> C + 'static,
    reference: fn(&mut WitnessOf<C>) -> bool,
) where
    C: DispatchCase,
    T: Debug + 'static,
    <C::Program as ProgramSchema>::Arguments: Default,
    WitnessOf<C>: Clone,
{
    // The engine replaces the witness of the template, any generated case will do
    let template = build(
        inputs
            .new_tree(&mut TestRunner::deterministic())
            .expect("the strategy generates a value")
            .current(),
    );

    let values = inputs.prop_map(move |input| -> FuzzProgramValues {
        (
            <C::Program as ProgramSchema>::Arguments::default().into(),
            build(input).witness().into(),
        )
            .into()
    });

    let mut scenario = Scenario::new(execution::spend(
        template.program().as_ref(),
        template.witness(),
        *context.get_network(),
    ));

    scenario
        .add::<C::Program>(FUZZED)
        .spends(0)
        .custom_strategy(values)
        .requires_witness(move |witness, _| {
            reference(witness);
        });

    context
        .engine(scenario)
        .spec(move |case| {
            let program = case.program::<C::Program>(FUZZED);
            let mut witness = program.witness().clone();

            accept_if(reference(&mut witness))
        })
        .run();
}

pub fn accept_if(accepted: bool) -> Expect {
    if accepted {
        Expect::Accept
    } else {
        Expect::Reject
    }
}

/// An amount near the edges: zero, small, the top of u64 or anything.
pub fn amounts() -> impl Strategy<Value = u64> {
    prop_oneof![
        Just(0),
        Just(u64::MAX),
        0..=10_000u64,
        (u64::MAX - 10_000)..=u64::MAX,
        any::<u64>(),
    ]
}

/// A protocol fee rate up to 100%, or above it where the protocol's part can overflow.
pub fn protocol_fee_rates() -> impl Strategy<Value = u64> {
    prop_oneof![
        Just(0),
        Just(FEE_RATE_DENOMINATOR),
        0..=FEE_RATE_DENOMINATOR,
        any::<u64>(),
    ]
}
