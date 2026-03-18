use crate::models::ActiveUtxo;
use simplicityhl::elements::OutPoint;
use std::collections::HashMap;

#[derive(Debug)]
enum PendingOp {
    Upsert(ActiveUtxo),
    Delete,
}

#[derive(Debug)]
pub struct UtxoCache {
    inner: HashMap<OutPoint, ActiveUtxo>,
    block_pending: Option<HashMap<OutPoint, PendingOp>>,
}

impl UtxoCache {
    pub fn new() -> Self {
        Self {
            inner: HashMap::new(),
            block_pending: None,
        }
    }

    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            inner: HashMap::with_capacity(capacity),
            block_pending: None,
        }
    }

    pub fn begin_block(&mut self) {
        if self.block_pending.is_none() {
            self.block_pending = Some(HashMap::new());
        }
    }

    pub fn commit_block(&mut self) {
        let Some(pending) = self.block_pending.take() else {
            return;
        };

        for (outpoint, op) in pending {
            match op {
                PendingOp::Upsert(active_utxo) => {
                    self.inner.insert(outpoint, active_utxo);
                }
                PendingOp::Delete => {
                    self.inner.remove(&outpoint);
                }
            }
        }
    }

    pub fn abort_block(&mut self) {
        self.block_pending = None;
    }

    pub fn insert(&mut self, outpoint: OutPoint, active_utxo: ActiveUtxo) {
        if let Some(pending) = self.block_pending.as_mut() {
            pending.insert(outpoint, PendingOp::Upsert(active_utxo));
        } else {
            self.inner.insert(outpoint, active_utxo);
        }
    }

    pub fn get(&self, outpoint: &OutPoint) -> Option<&ActiveUtxo> {
        if let Some(pending) = self.block_pending.as_ref()
            && let Some(op) = pending.get(outpoint)
        {
            return match op {
                PendingOp::Upsert(active_utxo) => Some(active_utxo),
                PendingOp::Delete => None,
            };
        }

        self.inner.get(outpoint)
    }

    pub fn remove(&mut self, outpoint: &OutPoint) {
        if let Some(pending) = self.block_pending.as_mut() {
            pending.insert(*outpoint, PendingOp::Delete);
        } else {
            self.inner.remove(outpoint);
        }
    }
}

impl Default for UtxoCache {
    fn default() -> Self {
        Self::new()
    }
}
