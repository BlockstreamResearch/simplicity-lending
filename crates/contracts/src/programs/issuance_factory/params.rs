use simplex::{provider::SimplicityNetwork, simplicityhl::elements::schnorr::XOnlyPublicKey};

use crate::artifacts::issuance_factory::derived_issuance_factory::IssuanceFactoryArguments;

#[derive(Debug, Clone, Copy)]
pub struct IssuanceFactoryParameters {
    pub issuing_utxos_count: u8,
    pub reissuance_flags: u64,
    pub owner_pubkey: XOnlyPublicKey,
    pub network: SimplicityNetwork,
}

impl IssuanceFactoryParameters {
    pub fn build_arguments(&self) -> IssuanceFactoryArguments {
        IssuanceFactoryArguments {
            issuing_utxos_count: self.issuing_utxos_count,
            reissuance_flags: self.reissuance_flags,
            factory_owner_pubkey: self.owner_pubkey.serialize(),
        }
    }
}
