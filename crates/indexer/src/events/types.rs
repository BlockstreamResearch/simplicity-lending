use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

pub const BLOCK_INDEXED_CHANNEL: &str = "lending_block_indexed";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum IndexerEvent {
    BlockIndexed { height: u64 },
}

#[cfg(test)]
mod tests {
    use super::IndexerEvent;

    #[test]
    fn block_indexed_serializes_with_type_tag() {
        let event = IndexerEvent::BlockIndexed { height: 123 };
        let json = serde_json::to_value(&event).expect("serialize");

        assert_eq!(json["type"], "block_indexed");
        assert_eq!(json["height"], 123);
    }

    #[test]
    fn block_indexed_roundtrips() {
        let event = IndexerEvent::BlockIndexed { height: 42 };
        let json = serde_json::to_string(&event).expect("serialize");
        let parsed: IndexerEvent = serde_json::from_str(&json).expect("deserialize");

        assert_eq!(parsed, event);
    }
}
