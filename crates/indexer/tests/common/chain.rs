use std::collections::HashMap;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::{Arc, Mutex};

use lending_indexer::indexer::ChainSource;
use simplex::simplicityhl::elements::Transaction;

struct StoredBlock {
    parent: String,
    txs: Vec<Transaction>,
}

struct Inner {
    base_height: u64,
    /// Hashes of the active chain, starting at `base_height`.
    active: Vec<String>,
    /// Every block ever produced, orphaned ones included, as Esplora keeps them.
    blocks: HashMap<String, StoredBlock>,
    reported_tip: Option<u64>,
}

/// An in-memory chain that can be reorganized. Clones share the same chain.
#[derive(Clone)]
pub struct FakeChain {
    inner: Arc<Mutex<Inner>>,
}

impl FakeChain {
    /// A chain whose first block is `base_height`, the block the indexer starts after.
    pub fn new(base_height: u64) -> Self {
        let base_hash = format!("base-{base_height}");
        Self {
            inner: Arc::new(Mutex::new(Inner {
                base_height,
                active: vec![base_hash],
                blocks: HashMap::new(),
                reported_tip: None,
            })),
        }
    }

    pub fn tip_height(&self) -> u64 {
        let inner = self.inner.lock().unwrap();
        inner.base_height + inner.active.len() as u64 - 1
    }

    pub fn hash_at(&self, height: u64) -> String {
        let inner = self.inner.lock().unwrap();
        inner.active[(height - inner.base_height) as usize].clone()
    }

    /// Mines a block with `txs` on top of the chain. The hash depends only on the parent and
    /// the txids, so the same blocks on the same parent get the same hashes.
    pub fn push(&self, txs: Vec<Transaction>) -> String {
        let mut inner = self.inner.lock().unwrap();
        let parent = inner.active.last().expect("base block").clone();

        let mut hasher = DefaultHasher::new();
        parent.hash(&mut hasher);
        for tx in &txs {
            tx.txid().to_string().hash(&mut hasher);
        }
        let hash = format!("{:016x}", hasher.finish());

        inner
            .blocks
            .insert(hash.clone(), StoredBlock { parent, txs });
        inner.active.push(hash.clone());

        hash
    }

    /// Replaces the last `depth` blocks with `blocks`.
    pub fn reorg(&self, depth: usize, blocks: Vec<Vec<Transaction>>) {
        {
            let mut inner = self.inner.lock().unwrap();
            assert!(depth < inner.active.len(), "cannot reorg the base block");
            let keep = inner.active.len() - depth;
            inner.active.truncate(keep);
        }

        for txs in blocks {
            self.push(txs);
        }
    }

    /// Makes the chain report `height` as its tip, like a lagging backend.
    pub fn report_tip(&self, height: Option<u64>) {
        self.inner.lock().unwrap().reported_tip = height;
    }
}

impl ChainSource for FakeChain {
    async fn tip_height(&self) -> anyhow::Result<u64> {
        let reported = self.inner.lock().unwrap().reported_tip;

        Ok(reported.unwrap_or_else(|| FakeChain::tip_height(self)))
    }

    async fn block_hash_at(&self, height: u64) -> anyhow::Result<String> {
        let inner = self.inner.lock().unwrap();
        height
            .checked_sub(inner.base_height)
            .and_then(|index| inner.active.get(index as usize))
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("no block at height {height}"))
    }

    async fn block_parent_hash(&self, hash: &str) -> anyhow::Result<String> {
        let inner = self.inner.lock().unwrap();
        inner
            .blocks
            .get(hash)
            .map(|block| block.parent.clone())
            .ok_or_else(|| anyhow::anyhow!("unknown block {hash}"))
    }

    async fn block_txs(&self, hash: &str) -> anyhow::Result<Vec<Transaction>> {
        let inner = self.inner.lock().unwrap();
        inner
            .blocks
            .get(hash)
            .map(|block| block.txs.clone())
            .ok_or_else(|| anyhow::anyhow!("unknown block {hash}"))
    }
}
