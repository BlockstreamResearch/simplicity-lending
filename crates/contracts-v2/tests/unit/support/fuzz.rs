use simplex::fuzz::proptest::prelude::{Just, Strategy, any, prop_oneof};
use simplex::fuzz::{Expect, FuzzProgramTrait, FuzzProgramValues, Scenario};
use simplex::{FuzzMode, TestContext};

use lending_contracts_v2::utils::protocol_fee::FEE_RATE_DENOMINATOR;

use crate::support::execution;

/// The name of the program in [`run`] scenarios.
const FUZZED: &str = "unit";

/// Fuzzes `program`, which takes no arguments, on the witnesses `cases` generates.
///
/// `set_expected` writes the model's result into a case, and the program must reject any other
/// expected value. The program must accept a case exactly when `model_accepts` holds for it.
pub fn run<P>(
    context: &TestContext<FuzzMode>,
    program: &P,
    template: P::Witness,
    cases: impl Strategy<Value = P::Witness> + 'static,
    set_expected: impl Fn(&mut P::Witness) + 'static,
    model_accepts: impl Fn(&P::Witness) -> bool + 'static,
) where
    P: FuzzProgramTrait,
    P::Arguments: Default,
{
    let values = cases.prop_map(|witness| -> FuzzProgramValues {
        (P::Arguments::default().into(), witness.into()).into()
    });

    let mut scenario = Scenario::new(execution::spend(
        program.as_ref(),
        template,
        *context.get_network(),
    ));

    scenario
        .add::<P>(FUZZED)
        .spends(0)
        .custom_strategy(values)
        .requires_witness(move |witness, _| set_expected(witness));

    context
        .engine(scenario)
        .spec(move |case| accept_if(model_accepts(case.program::<P>(FUZZED).witness())))
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
