use simplex::simplicityhl::elements::OutPoint;
use std::collections::HashMap;

use crate::models::ActiveUtxo;

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

#[cfg(test)]
mod tests {
    use super::UtxoCache;
    use crate::models::{ActiveUtxo, UtxoData, UtxoType};
    use simplex::simplicityhl::elements::{OutPoint, Txid, hashes::Hash};
    use uuid::Uuid;

    fn outpoint(txid_byte: u8, vout: u32) -> OutPoint {
        OutPoint {
            txid: Txid::from_slice(&[txid_byte; 32]).expect("valid txid bytes"),
            vout,
        }
    }

    fn active_utxo(offer_byte: u8) -> ActiveUtxo {
        ActiveUtxo {
            offer_id: Uuid::from_bytes([offer_byte; 16]),
            data: UtxoData::Offer(UtxoType::PreLock),
        }
    }

    #[test]
    fn insert_and_remove_without_active_block_apply_immediately() {
        let mut cache = UtxoCache::new();
        let op = outpoint(1, 0);

        cache.insert(op, active_utxo(10));
        assert_eq!(
            cache.get(&op).map(|u| u.offer_id),
            Some(Uuid::from_bytes([10; 16]))
        );

        cache.remove(&op);
        assert!(cache.get(&op).is_none());
    }

    #[test]
    fn begin_block_is_idempotent_and_preserves_pending_delta() {
        let mut cache = UtxoCache::new();
        let op = outpoint(2, 0);

        cache.begin_block();
        cache.insert(op, active_utxo(20));
        cache.begin_block();
        cache.commit_block();

        assert_eq!(
            cache.get(&op).map(|u| u.offer_id),
            Some(Uuid::from_bytes([20; 16]))
        );
    }

    #[test]
    fn pending_changes_are_visible_before_commit() {
        let mut cache = UtxoCache::new();
        let existing = outpoint(3, 0);
        let pending = outpoint(4, 0);

        cache.insert(existing, active_utxo(30));
        cache.begin_block();
        cache.remove(&existing);
        cache.insert(pending, active_utxo(40));

        assert!(cache.get(&existing).is_none());
        assert_eq!(
            cache.get(&pending).map(|u| u.offer_id),
            Some(Uuid::from_bytes([40; 16]))
        );
    }

    #[test]
    fn abort_block_discards_all_pending_changes() {
        let mut cache = UtxoCache::new();
        let existing = outpoint(5, 0);
        let pending = outpoint(6, 0);

        cache.insert(existing, active_utxo(50));
        cache.begin_block();
        cache.remove(&existing);
        cache.insert(pending, active_utxo(60));
        cache.abort_block();

        assert_eq!(
            cache.get(&existing).map(|u| u.offer_id),
            Some(Uuid::from_bytes([50; 16]))
        );
        assert!(cache.get(&pending).is_none());
    }

    #[test]
    fn commit_block_applies_pending_changes() {
        let mut cache = UtxoCache::new();
        let existing = outpoint(7, 0);
        let pending = outpoint(8, 0);

        cache.insert(existing, active_utxo(70));
        cache.begin_block();
        cache.remove(&existing);
        cache.insert(pending, active_utxo(80));
        cache.commit_block();

        assert!(cache.get(&existing).is_none());
        assert_eq!(
            cache.get(&pending).map(|u| u.offer_id),
            Some(Uuid::from_bytes([80; 16]))
        );
    }

    #[test]
    fn latest_pending_operation_wins_for_same_outpoint() {
        let mut cache = UtxoCache::new();
        let op = outpoint(9, 0);

        cache.begin_block();
        cache.insert(op, active_utxo(90));
        cache.remove(&op);
        cache.insert(op, active_utxo(91));
        cache.commit_block();

        assert_eq!(
            cache.get(&op).map(|u| u.offer_id),
            Some(Uuid::from_bytes([91; 16]))
        );
    }

    #[test]
    fn commit_without_active_block_is_noop() {
        let mut cache = UtxoCache::new();
        let op = outpoint(10, 0);
        cache.insert(op, active_utxo(100));

        cache.commit_block();

        assert_eq!(
            cache.get(&op).map(|u| u.offer_id),
            Some(Uuid::from_bytes([100; 16]))
        );
    }

    #[test]
    fn abort_without_active_block_is_noop() {
        let mut cache = UtxoCache::new();
        let op = outpoint(11, 0);
        cache.insert(op, active_utxo(110));

        cache.abort_block();

        assert_eq!(
            cache.get(&op).map(|u| u.offer_id),
            Some(Uuid::from_bytes([110; 16]))
        );
    }

    #[test]
    fn abort_then_retry_produces_correct_state() {
        let mut cache = UtxoCache::new();
        let existing = outpoint(12, 0);
        let aborted_new = outpoint(13, 0);
        let committed_new = outpoint(14, 0);

        cache.insert(existing, active_utxo(120));

        cache.begin_block();
        cache.remove(&existing);
        cache.insert(aborted_new, active_utxo(130));
        cache.abort_block();

        cache.begin_block();
        cache.remove(&existing);
        cache.insert(committed_new, active_utxo(140));
        cache.commit_block();

        assert!(cache.get(&existing).is_none());
        assert!(cache.get(&aborted_new).is_none());
        assert_eq!(
            cache.get(&committed_new).map(|u| u.offer_id),
            Some(Uuid::from_bytes([140; 16]))
        );
    }
}
