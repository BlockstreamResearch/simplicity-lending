use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("Database error: {0}")]
    DatabaseError(#[from] sqlx::Error),

    #[error("Offer not found: {0}")]
    NotFound(String),

    #[error("Validation error: {0}")]
    BadRequest(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, error_code, message) = match &self {
            ApiError::DatabaseError(e) => {
                tracing::error!("Internal database error: {:?}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal_error",
                    "An unexpected error occurred".to_string(),
                )
            }
            ApiError::NotFound(id) => (
                StatusCode::NOT_FOUND,
                "not_found",
                format!("Resource not found: {}", id),
            ),
            ApiError::BadRequest(msg) => (StatusCode::BAD_REQUEST, "bad_request", msg.clone()),
        };

        let body = Json(json!({
            "error": {
                "code": error_code,
                "message": message
            }
        }));

        (status, body).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::ApiError;
    use axum::{body::to_bytes, http::StatusCode, response::IntoResponse};
    use serde_json::Value;

    #[tokio::test]
    async fn bad_request_maps_to_400_with_expected_error_payload() {
        let response = ApiError::BadRequest("invalid params".to_string()).into_response();
        let status = response.status();
        let body_bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body");
        let json: Value = serde_json::from_slice(&body_bytes).expect("valid json");

        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(json["error"]["code"], "bad_request");
        assert_eq!(json["error"]["message"], "invalid params");
    }

    #[tokio::test]
    async fn not_found_maps_to_404_with_resource_message() {
        let response = ApiError::NotFound("offer-1".to_string()).into_response();
        let status = response.status();
        let body_bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body");
        let json: Value = serde_json::from_slice(&body_bytes).expect("valid json");

        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(json["error"]["code"], "not_found");
        assert_eq!(json["error"]["message"], "Resource not found: offer-1");
    }

    #[tokio::test]
    async fn database_error_maps_to_500_with_generic_message() {
        let response = ApiError::DatabaseError(sqlx::Error::RowNotFound).into_response();
        let status = response.status();
        let body_bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body");
        let json: Value = serde_json::from_slice(&body_bytes).expect("valid json");

        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(json["error"]["code"], "internal_error");
        assert_eq!(json["error"]["message"], "An unexpected error occurred");
    }
}
