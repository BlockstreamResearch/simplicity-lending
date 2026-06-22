use simplex::provider::{EsploraProvider, SimplicityNetwork};
use simplex::signer::Signer;

pub struct Session {
    provider: EsploraProvider,
    signer: Signer,
}

impl Session {
    pub fn new(provider: EsploraProvider, signer: Signer) -> Self {
        Self { provider, signer }
    }

    pub fn provider(&self) -> &EsploraProvider {
        &self.provider
    }

    pub fn signer(&self) -> &Signer {
        &self.signer
    }

    pub fn network(&self) -> SimplicityNetwork {
        self.provider.network
    }

    pub fn into_parts(self) -> (EsploraProvider, Signer) {
        (self.provider, self.signer)
    }
}
