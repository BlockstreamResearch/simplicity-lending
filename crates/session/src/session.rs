use simplex::provider::{EsploraProvider, SimplicityNetwork};
use simplex::signer::Signer;

use crate::indexer::IndexerClient;

pub struct Session {
    pub(crate) provider: EsploraProvider,
    pub(crate) signer: Signer,
    pub(crate) indexer: IndexerClient,
}

impl Session {
    pub fn new(provider: EsploraProvider, signer: Signer, indexer: IndexerClient) -> Self {
        Self {
            provider,
            signer,
            indexer,
        }
    }

    pub fn provider(&self) -> &EsploraProvider {
        &self.provider
    }

    pub fn signer(&self) -> &Signer {
        &self.signer
    }

    pub fn indexer(&self) -> &IndexerClient {
        &self.indexer
    }

    pub fn network(&self) -> SimplicityNetwork {
        self.provider.network
    }

    pub fn into_parts(self) -> (EsploraProvider, Signer, IndexerClient) {
        (self.provider, self.signer, self.indexer)
    }
}
