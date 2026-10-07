use crate::artifacts::script_auth::ScriptAuthProgram;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScriptAuthStorage {
    pub auth_script_hash: [u8; 32],
}

impl ScriptAuthStorage {
    #[allow(unused_must_use)]
    pub(crate) fn apply(&self, program: &mut ScriptAuthProgram) {
        program.set_storage_at(0, self.auth_script_hash);
    }
}
