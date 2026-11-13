use crate::artifacts::contracts::script_auth::ScriptAuthProgram;
use crate::utils::storage::set_storage_slots;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScriptAuthStorage {
    pub auth_script_hash: [u8; 32],
}

impl ScriptAuthStorage {
    pub const SLOTS: usize = 1;

    #[must_use]
    pub fn slots(&self) -> [[u8; 32]; Self::SLOTS] {
        [self.auth_script_hash]
    }

    pub(crate) fn apply(&self, program: &mut ScriptAuthProgram) {
        set_storage_slots(program, &self.slots());
    }
}
