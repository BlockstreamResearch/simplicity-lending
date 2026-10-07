use simplex::simplicityhl::elements::AssetId;

use crate::artifacts::asset_auth::AssetAuthProgram;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AssetAuthStorage {
    pub auth_asset_id: AssetId,
}

impl AssetAuthStorage {
    #[allow(unused_must_use)]
    pub(crate) fn apply(&self, program: &mut AssetAuthProgram) {
        program.set_storage_at(0, self.auth_asset_id.into_inner().0);
    }
}
