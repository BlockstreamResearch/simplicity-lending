use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::models::OfferStatus;

pub const INDEXER_EVENTS_CHANNEL: &str = "lending_indexer_events";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum IndexerEvent {
    BlockIndexed {
        height: u64,
    },
    FactoryCreated {
        id: Uuid,
        height: u64,
        factory_auth_script_pubkey: String,
    },
    OfferCreated {
        id: String,
        issuance_factory_id: Uuid,
        height: u64,
        created_at_txid: String,
        borrower_script_pubkey: String,
    },
    OfferStatusUpdated {
        id: String,
        status: OfferStatus,
        height: u64,
    },
}

impl IndexerEvent {
    pub fn sse_event_name(&self) -> &'static str {
        match self {
            Self::BlockIndexed { .. } => "block_indexed",
            Self::FactoryCreated { .. } => "factory_created",
            Self::OfferCreated { .. } => "offer_created",
            Self::OfferStatusUpdated { .. } => "offer_status_updated",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::IndexerEvent;
    use crate::models::OfferStatus;
    use uuid::Uuid;

    #[test]
    fn block_indexed_serializes_with_type_tag() {
        let event = IndexerEvent::BlockIndexed { height: 123 };
        let json = serde_json::to_value(&event).expect("serialize");

        assert_eq!(json["type"], "block_indexed");
        assert_eq!(json["height"], 123);
    }

    #[test]
    fn factory_created_serializes_with_type_tag() {
        let factory_id = Uuid::new_v4();
        let event = IndexerEvent::FactoryCreated {
            id: factory_id,
            height: 100,
            factory_auth_script_pubkey: "52ac".to_string(),
        };
        let json = serde_json::to_value(&event).expect("serialize");

        assert_eq!(json["type"], "factory_created");
        assert_eq!(json["id"], factory_id.to_string());
        assert_eq!(json["height"], 100);
        assert_eq!(json["factory_auth_script_pubkey"], "52ac");
    }

    #[test]
    fn offer_created_serializes_with_type_tag() {
        let factory_id = Uuid::new_v4();
        let event = IndexerEvent::OfferCreated {
            id: "42".to_string(),
            issuance_factory_id: factory_id,
            height: 200,
            created_at_txid: "aabb".to_string(),
            borrower_script_pubkey: "52ac".to_string(),
        };
        let json = serde_json::to_value(&event).expect("serialize");

        assert_eq!(json["type"], "offer_created");
        assert_eq!(json["id"], "42");
        assert_eq!(json["borrower_script_pubkey"], "52ac");
    }

    #[test]
    fn offer_status_updated_serializes_with_type_tag() {
        let event = IndexerEvent::OfferStatusUpdated {
            id: "7".to_string(),
            status: OfferStatus::Active,
            height: 300,
        };
        let json = serde_json::to_value(&event).expect("serialize");

        assert_eq!(json["type"], "offer_status_updated");
        assert_eq!(json["status"], "active");
    }

    #[test]
    fn events_roundtrip() {
        let events = [
            IndexerEvent::BlockIndexed { height: 42 },
            IndexerEvent::FactoryCreated {
                id: Uuid::new_v4(),
                height: 1,
                factory_auth_script_pubkey: "52".to_string(),
            },
            IndexerEvent::OfferCreated {
                id: "1".to_string(),
                issuance_factory_id: Uuid::new_v4(),
                height: 2,
                created_at_txid: "cc".to_string(),
                borrower_script_pubkey: "52".to_string(),
            },
            IndexerEvent::OfferStatusUpdated {
                id: "1".to_string(),
                status: OfferStatus::Repaid,
                height: 3,
            },
        ];

        for event in events {
            let json = serde_json::to_string(&event).expect("serialize");
            let parsed: IndexerEvent = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(parsed, event);
        }
    }
}
