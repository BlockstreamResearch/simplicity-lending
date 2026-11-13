use simplex::transaction::FinalTransaction;

/// The index the next output added to `ft` gets.
#[must_use]
pub fn next_output_index(ft: &FinalTransaction) -> u32 {
    u32::try_from(ft.n_outputs()).expect("a transaction has fewer than u32::MAX outputs")
}
