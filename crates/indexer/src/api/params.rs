use serde::Deserialize;
use serde::de::Error;

use utoipa::{IntoParams, ToSchema};

use uuid::Uuid;

use crate::models::OfferStatus;

#[derive(Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
pub struct ScriptQuery {
    #[param(example = "00144f883a4bb668547b534ae815bc32628893b6f435")]
    pub script_pubkey: String,
}

#[derive(Debug, Clone, Copy, Deserialize, Default, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SortDir {
    #[default]
    Desc,
    Asc,
}

#[derive(Debug, Clone, Copy, Deserialize, Default, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum OfferSortBy {
    #[default]
    CreatedAtHeight,
    CollateralAmount,
    PrincipalAmount,
    InterestRate,
    LoanExpirationHeight,
}

impl OfferSortBy {
    pub fn sql_column(self) -> &'static str {
        match self {
            Self::CreatedAtHeight => "created_at_height",
            Self::CollateralAmount => "collateral_amount",
            Self::PrincipalAmount => "principal_amount",
            Self::InterestRate => "interest_rate",
            Self::LoanExpirationHeight => "loan_expiration_time",
        }
    }
}

const DEFAULT_OFFER_LIST_LIMIT: u64 = 50;
const MAX_OFFER_LIST_LIMIT: u64 = 100;

/// Shared offer-list filter query parameters.
#[derive(Deserialize, Debug, Default)]
pub struct OfferFilters {
    /// Comma-separated offer states, e.g. `pending,active`.
    #[serde(default, deserialize_with = "deserialize_offer_statuses")]
    pub status: Vec<OfferStatus>,
    /// Collateral asset hex (same byte order as API responses).
    pub collateral_asset: Option<String>,
    /// Principal asset hex (same byte order as API responses).
    pub principal_asset: Option<String>,
    pub factory_id: Option<Uuid>,
    /// Maximum records to return (default 50, max 100).
    #[serde(default, deserialize_with = "deserialize_optional_u64")]
    pub limit: Option<u64>,
    #[serde(default, deserialize_with = "deserialize_optional_u64")]
    pub offset: Option<u64>,
    #[serde(default)]
    pub sort_by: OfferSortBy,
    #[serde(default)]
    pub sort_dir: SortDir,
}

pub type OfferListQuery = OfferFilters;

impl OfferFilters {
    pub fn effective_limit(&self) -> u64 {
        self.limit
            .unwrap_or(DEFAULT_OFFER_LIST_LIMIT)
            .min(MAX_OFFER_LIST_LIMIT)
    }

    pub fn effective_offset(&self) -> u64 {
        self.offset.unwrap_or(0)
    }
}

fn deserialize_offer_statuses<'de, D>(deserializer: D) -> Result<Vec<OfferStatus>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let segment = String::deserialize(deserializer)?;
    OfferStatus::parse_csv(&segment).map_err(D::Error::custom)
}

/// Query params are always strings; `#[serde(flatten)]` does not coerce them to integers.
fn deserialize_optional_u64<'de, D>(deserializer: D) -> Result<Option<u64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<String>::deserialize(deserializer)?;
    value
        .map(|s| s.parse().map_err(D::Error::custom))
        .transpose()
}

#[cfg(test)]
mod tests {
    use super::{OfferListQuery, OfferStatus};

    #[test]
    fn offer_list_query_caps_limit() {
        let query = OfferListQuery {
            limit: Some(500),
            ..OfferListQuery::default()
        };
        assert_eq!(query.effective_limit(), 100);
    }

    #[test]
    fn offer_list_query_default_pagination() {
        let query = OfferListQuery::default();
        assert_eq!(query.effective_limit(), 50);
        assert_eq!(query.effective_offset(), 0);
    }

    #[test]
    fn offer_list_query_parses_status_filters() {
        let cases = [
            ("status=pending", vec![OfferStatus::Pending]),
            (
                "status=pending,active",
                vec![OfferStatus::Pending, OfferStatus::Active],
            ),
        ];

        for (query, expected) in cases {
            let parsed: OfferListQuery = serde_urlencoded::from_str(query).expect(query);
            assert_eq!(parsed.status, expected, "query: {query}");
        }
    }

    #[test]
    fn offer_list_query_parses_pagination_from_query_string() {
        let parsed: OfferListQuery =
            serde_urlencoded::from_str("limit=10&offset=5").expect("parse pagination");
        assert_eq!(parsed.limit, Some(10));
        assert_eq!(parsed.offset, Some(5));
    }

    #[test]
    fn offer_list_query_parses_sort_by_loan_expiration_height() {
        let parsed: OfferListQuery =
            serde_urlencoded::from_str("sort_by=loan_expiration_height").expect("parse sort_by");
        assert!(matches!(
            parsed.sort_by,
            super::OfferSortBy::LoanExpirationHeight
        ));
    }
}
