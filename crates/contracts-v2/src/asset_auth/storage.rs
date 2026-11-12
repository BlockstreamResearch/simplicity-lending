use simplex::simplicityhl::elements::AssetId;

use crate::artifacts::asset_auth::AssetAuthProgram;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AssetAuthStorage {
    pub auth_asset_id: AssetId,
}

impl AssetAuthStorage {
    pub const SLOTS: usize = 1;

    #[must_use]
    pub fn slots(&self) -> [[u8; 32]; Self::SLOTS] {
        [self.auth_asset_id.to_byte_array()]
    }

    pub(crate) fn apply(&self, program: &mut AssetAuthProgram) {
        for (index, slot) in self.slots().into_iter().enumerate() {
            program.set_storage_at(index, slot);
        }
    }
}
