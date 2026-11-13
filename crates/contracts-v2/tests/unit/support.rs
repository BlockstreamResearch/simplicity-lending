use simplex::program::{Program, ProgramError, ProgramTrait};
use simplex::provider::SimplicityNetwork;
use simplex::simplicityhl::WitnessValues;
use simplex::simplicityhl::elements::{OutPoint, Script, Txid};
use simplex::transaction::{FinalTransaction, PartialInput, PartialOutput, ProgramInput, UTXO};

const AMOUNT: u64 = 1_000;

/// A transaction whose only input spends a UTXO locked by `program`.
///
/// Unit programs do not look at the transaction, it only gives them an environment to run in.
pub fn spend(
    program: &Program,
    witness: impl Into<WitnessValues>,
    network: SimplicityNetwork,
) -> FinalTransaction {
    let asset = network.policy_asset();
    let utxo = UTXO::explicit(
        OutPoint::new(Txid::from_byte_array([0xf0; 32]), 0),
        program.get_script_pubkey(&network),
        AMOUNT,
        asset,
    );

    let mut ft = FinalTransaction::new();
    ft.add_program_input(
        PartialInput::new(utxo),
        ProgramInput::new(Box::new(program.clone()), witness),
        None,
    );
    ft.add_output(PartialOutput::new(Script::from(vec![0x51]), AMOUNT, asset));

    ft
}

/// Runs `program` on `witness` without a node.
pub fn run(program: &Program, witness: impl Into<WitnessValues>) -> Result<(), ProgramError> {
    let network = SimplicityNetwork::default_regtest();
    let witness = witness.into();

    let (pst, _) = spend(program, witness.clone(), network)
        .extract_pst()
        .expect("the unit transaction is explicit");

    program.execute(&pst, &witness, 0, &network).map(|_| ())
}

#[track_caller]
pub fn accepts(program: &Program, witness: impl Into<WitnessValues>) {
    if let Err(error) = run(program, witness) {
        panic!("expected the program to accept, but it failed: {error}");
    }
}

/// Asserts that `program` fails while running on `witness`.
///
/// Any other error means the case is malformed and the function was never reached.
#[track_caller]
pub fn rejects(program: &Program, witness: impl Into<WitnessValues>) {
    match run(program, witness) {
        Err(ProgramError::Pruning(_) | ProgramError::Execution(_)) => {}
        Err(other) => panic!("the case failed before the program ran: {other}"),
        Ok(()) => panic!("expected the program to reject, but it accepted"),
    }
}
