use simplex::fuzz::FuzzProgramTrait;
use simplex::transaction::FinalTransaction;

/// Edits the witness of the `P` spending `input`.
///
/// # Panics
/// Panics when `input` is not spent by a `P`.
pub fn witness<P: FuzzProgramTrait>(
    ft: &mut FinalTransaction,
    input: usize,
    edit: impl FnOnce(&mut P::Witness),
) {
    let program_input = ft.inputs_mut()[input]
        .program_input
        .as_mut()
        .unwrap_or_else(|| panic!("input {input} runs no program"));

    let mut witness = P::Witness::try_from(&program_input.witness)
        .unwrap_or_else(|error| panic!("input {input} has another program's witness: {error}"));
    edit(&mut witness);

    program_input.witness = witness.into();
}

/// Swaps inputs `a` and `b`, witnesses included.
pub fn swap_inputs(ft: &mut FinalTransaction, a: usize, b: usize) {
    ft.inputs_mut().swap(a, b);
}
