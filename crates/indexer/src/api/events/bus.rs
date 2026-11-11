use std::sync::Arc;

use tokio::sync::{OwnedSemaphorePermit, Semaphore, broadcast};

use crate::events::IndexerEvent;

const EVENT_BUS_CAPACITY: usize = 64;

/// Upper bound on concurrent SSE subscribers in this process. The reverse
/// proxy caps `/events` lower than this; this is the backstop for direct access.
const MAX_SSE_SUBSCRIBERS: usize = 512;

#[derive(Clone, Debug)]
pub struct EventBus {
    sender: broadcast::Sender<IndexerEvent>,
    subscriber_slots: Arc<Semaphore>,
}

/// A live subscription. Its slot is released when it is dropped.
#[derive(Debug)]
pub struct Subscription {
    pub receiver: broadcast::Receiver<IndexerEvent>,
    _permit: OwnedSemaphorePermit,
}

impl EventBus {
    pub fn new() -> Self {
        Self::with_max_subscribers(MAX_SSE_SUBSCRIBERS)
    }

    pub fn with_max_subscribers(max_subscribers: usize) -> Self {
        let (sender, _) = broadcast::channel(EVENT_BUS_CAPACITY);

        Self {
            sender,
            subscriber_slots: Arc::new(Semaphore::new(max_subscribers)),
        }
    }

    pub fn publish(&self, event: IndexerEvent) {
        // No active subscribers is fine — `send` returns Err in that case.
        let _ = self.sender.send(event);
    }

    /// Returns `None` when all subscriber slots are taken.
    pub fn subscribe(&self) -> Option<Subscription> {
        let permit = self.subscriber_slots.clone().try_acquire_owned().ok()?;

        Some(Subscription {
            receiver: self.sender.subscribe(),
            _permit: permit,
        })
    }
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::EventBus;

    #[test]
    fn subscribe_rejects_when_full_and_frees_slot_on_drop() {
        let bus = EventBus::with_max_subscribers(1);

        let first = bus.subscribe().expect("first subscription fits");
        assert!(
            bus.subscribe().is_none(),
            "second subscription must be rejected"
        );

        drop(first);
        assert!(
            bus.subscribe().is_some(),
            "slot must be released when a subscription is dropped"
        );
    }
}
