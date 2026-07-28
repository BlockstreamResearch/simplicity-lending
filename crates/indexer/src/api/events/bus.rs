use tokio::sync::broadcast;

use crate::events::IndexerEvent;

const EVENT_BUS_CAPACITY: usize = 64;

#[derive(Clone, Debug)]
pub struct EventBus {
    sender: broadcast::Sender<IndexerEvent>,
}

impl EventBus {
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(EVENT_BUS_CAPACITY);

        Self { sender }
    }

    pub fn publish(&self, event: IndexerEvent) {
        // No active subscribers is fine — `send` returns Err in that case.
        let _ = self.sender.send(event);
    }

    pub fn subscribe(&self) -> broadcast::Receiver<IndexerEvent> {
        self.sender.subscribe()
    }
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}
