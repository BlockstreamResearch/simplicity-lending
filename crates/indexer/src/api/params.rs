use serde::Deserialize;
use serde::de::Error;
use uuid::Uuid;

use crate::models::OfferStatus;

#[derive(Deserialize)]
pub struct ScriptQuery {
    pub script_pubkey: String,
}

#[derive(Debug, Clone, Copy, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum SortDir {
    #[default]
    Desc,
    Asc,
}

#[derive(Debug, Clone, Copy, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum OfferSortBy {
    #[default]
    CreatedAtHeight,
    CollateralAmount,
    PrincipalAmount,
    InterestRate,
    LoanExpirationTime,
}

impl OfferSortBy {
    pub fn sql_column(self) -> &'static str {
        match self {
            Self::CreatedAtHeight => "created_at_height",
            Self::CollateralAmount => "collateral_amount",
            Self::PrincipalAmount => "principal_amount",
            Self::InterestRate => "interest_rate",
            Self::LoanExpirationTime => "loan_expiration_time",
        }
    }
}

const DEFAULT_OFFER_LIST_LIMIT: u64 = 50;
const MAX_OFFER_LIST_LIMIT: u64 = 100;

#[derive(Deserialize, Debug, Default)]
pub struct OfferListQuery {
    #[serde(default, deserialize_with = "deserialize_offer_statuses")]
    pub status: Vec<OfferStatus>,
    pub collateral_asset: Option<String>,
    pub principal_asset: Option<String>,
    pub factory_id: Option<Uuid>,
    pub limit: Option<u64>,
    pub offset: Option<u64>,
    #[serde(default)]
    pub sort_by: OfferSortBy,
    #[serde(default)]
    pub sort_dir: SortDir,
}

impl OfferListQuery {
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
}
