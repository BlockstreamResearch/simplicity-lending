use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::State;
use axum::response::sse::{Event, KeepAlive, Sse};
use futures_util::stream::{Stream, unfold};
use tokio::sync::broadcast::error::RecvError;

use crate::api::AppState;

#[utoipa::path(
    get,
    path = "/events",
    tag = "events",
    operation_id = "subscribe_indexer_events",
    responses(
        (
            status = 200,
            description = "Server-Sent Events stream. Event types: `block_indexed`, `factory_created`, `offer_created`, `offer_status_updated`, `offer_repayment_indexed`. Each `data` field carries a tagged JSON `IndexerEvent`. Clients should refetch REST resources on receipt.",
            content_type = "text/event-stream"
        ),
    )
)]
#[tracing::instrument(name = "Subscribing to indexer events", skip(state))]
pub async fn subscribe_events(
    State(state): State<Arc<AppState>>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let receiver = state.events.subscribe();

    let stream = unfold(receiver, |mut receiver| async move {
        loop {
            match receiver.recv().await {
                Ok(event) => {
                    let sse_event = Event::default()
                        .event(event.sse_event_name())
                        .json_data(&event);

                    match sse_event {
                        Ok(sse_event) => return Some((Ok(sse_event), receiver)),
                        Err(error) => {
                            tracing::error!(?error, "Failed to serialize SSE event");
                            continue;
                        }
                    }
                }
                Err(RecvError::Lagged(skipped)) => {
                    tracing::warn!(skipped, "SSE subscriber lagged; continuing");
                    continue;
                }
                Err(RecvError::Closed) => return None,
            }
        }
    });

    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    )
}
