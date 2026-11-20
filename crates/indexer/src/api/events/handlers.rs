use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::State;
use axum::response::sse::{Event, KeepAlive, Sse};
use futures_util::stream::{Stream, unfold};
use tokio::sync::broadcast::error::RecvError;

use crate::api::{ApiError, AppState};

#[utoipa::path(
    get,
    path = "/events",
    tag = "events",
    operation_id = "subscribe_indexer_events",
    responses(
        (
            status = 200,
            description = "Server-Sent Events stream. Event types: `block_indexed`, `factory_created`, `offer_created`, `offer_status_updated`, `offer_repayment_indexed`, `offer_vault_withdrawal_indexed`. Each `data` field carries a tagged JSON `IndexerEvent`. Clients should refetch REST resources on receipt.",
            content_type = "text/event-stream"
        ),
        (
            status = 503,
            description = "Subscriber limit reached. Clients should retry with backoff."
        ),
    )
)]
#[tracing::instrument(name = "Subscribing to indexer events", skip(state))]
pub async fn subscribe_events(
    State(state): State<Arc<AppState>>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, ApiError> {
    let Some(subscription) = state.events.subscribe() else {
        tracing::warn!("SSE subscriber limit reached; rejecting subscription");
        return Err(ApiError::ServiceUnavailable(
            "Too many event subscribers, retry later".to_string(),
        ));
    };

    // The subscription (and its slot) lives as long as the stream does.
    let stream = unfold(subscription, |mut subscription| async move {
        loop {
            match subscription.receiver.recv().await {
                Ok(event) => {
                    let sse_event = Event::default()
                        .event(event.sse_event_name())
                        .json_data(&event);

                    match sse_event {
                        Ok(sse_event) => return Some((Ok(sse_event), subscription)),
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

    Ok(Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    ))
}
