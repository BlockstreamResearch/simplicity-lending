use simplex::include_simf;
use simplex::program::{ArgumentsTrait, Program};
use simplex::simplicityhl::elements::secp256k1_zkp::XOnlyPublicKey;
pub struct LendingProgram {
    program: Program,
}
impl LendingProgram {
    pub const SOURCE: &'static str = derived_lending::LENDING_CONTRACT_SOURCE;
    pub fn new(arguments: impl ArgumentsTrait + 'static) -> Self {
        Self {
            program: Program::new(Self::SOURCE, Box::new(arguments)),
        }
    }
    pub fn with_pub_key(mut self, pub_key: XOnlyPublicKey) -> Self {
        self.program = self.program.with_pub_key(pub_key);
        self
    }
    pub fn with_storage_capacity(mut self, capacity: usize) -> Self {
        self.program = self.program.with_storage_capacity(capacity);
        self
    }
    pub fn set_storage_at(&mut self, index: usize, new_value: [u8; 32]) {
        self.program.set_storage_at(index, new_value);
    }
    pub fn get_storage_len(&self) -> usize {
        self.program.get_storage_len()
    }
    pub fn get_storage(&self) -> &[[u8; 32]] {
        self.program.get_storage()
    }
    pub fn get_storage_at(&self, index: usize) -> [u8; 32] {
        self.program.get_storage_at(index)
    }
    pub fn get_program(&self) -> &Program {
        &self.program
    }
    pub fn get_program_mut(&mut self) -> &mut Program {
        &mut self.program
    }
}
include_simf!("simf/lending.simf");
