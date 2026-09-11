use crate::artifacts::fee_collector::derived_fee_collector::FeeCollectorWitness;

#[derive(Debug, Clone, Copy)]
pub struct FeeCollectorWitnessParams {
    pub signature: [u8; 64],
}

impl FeeCollectorWitnessParams {
    pub fn new(signature: [u8; 64]) -> Self {
        Self { signature }
    }

    pub fn build_witness(&self) -> Box<FeeCollectorWitness> {
        Box::new(FeeCollectorWitness {
            signature: self.signature,
        })
    }
}
