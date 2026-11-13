/// An auth UTXO that a spending path moves from `input_index` to `output_index`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AuthTransfer {
    pub input_index: u32,
    pub output_index: u32,
}
