use serde::Deserialize;
use serde::de::Error;

use utoipa::{IntoParams, ToSchema};

use uuid::Uuid;

use crate::api::error::ApiError;
use crate::api::utils::parse_script_pubkey;
use crate::models::{OfferStatus, ParticipantType};

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
    UpdatedAtHeight,
    CreatedAtHeight,
    CollateralAmount,
    PrincipalAmount,
    InterestRate,
    LoanExpirationHeight,
}

impl OfferSortBy {
    pub fn sql_column(self) -> &'static str {
        match self {
            Self::UpdatedAtHeight => "updated_at_height",
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
    /// Excludes offers where this script is the latest participant for the given role.
    pub exclude_participant_script: Option<String>,
    /// Participant role for `exclude_participant_script` (default: `borrower`).
    #[serde(default)]
    pub exclude_participant_role: Option<ParticipantType>,
    #[serde(skip, default)]
    parsed_exclude_participant: Option<(ParticipantType, Vec<u8>)>,
    /// When true, only offers with `loan_expiration_time >= last_indexed_height` are returned.
    #[serde(default, deserialize_with = "deserialize_query_bool")]
    pub not_expired: bool,
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

    /// Validates and decodes `exclude_participant_script` into an owned form for SQL filters.
    pub fn prepare_exclude_participant(&mut self) -> Result<(), ApiError> {
        let Some(script_hex) = self.exclude_participant_script.as_deref() else {
            return Ok(());
        };

        let script_bytes = parse_script_pubkey(script_hex)?;
        let participant_type = self
            .exclude_participant_role
            .unwrap_or(ParticipantType::Borrower);

        self.parsed_exclude_participant = Some((participant_type, script_bytes));

        Ok(())
    }

    pub fn exclude_participant_for_sql(&self) -> Option<(ParticipantType, &[u8])> {
        self.parsed_exclude_participant
            .as_ref()
            .map(|(role, script)| (*role, script.as_slice()))
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

fn deserialize_query_bool<'de, D>(deserializer: D) -> Result<bool, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<String>::deserialize(deserializer)?;
    match value.as_deref() {
        None => Ok(false),
        Some("true") | Some("1") => Ok(true),
        Some("false") | Some("0") | Some("") => Ok(false),
        Some(other) => Err(D::Error::custom(format!(
            "invalid boolean \"{other}\", expected true or false"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::{OfferListQuery, OfferStatus};
    use crate::models::ParticipantType;

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

    #[test]
    fn offer_list_query_defaults_to_updated_at_height_sort() {
        let parsed: OfferListQuery = serde_urlencoded::from_str("").expect("parse empty query");
        assert!(matches!(
            parsed.sort_by,
            super::OfferSortBy::UpdatedAtHeight
        ));
    }

    #[test]
    fn offer_list_query_parses_exclude_participant_script() {
        let parsed: OfferListQuery =
            serde_urlencoded::from_str("exclude_participant_script=52ac").expect("parse exclude");
        assert_eq!(parsed.exclude_participant_script.as_deref(), Some("52ac"));
        assert_eq!(parsed.exclude_participant_role, None);
    }

    #[test]
    fn offer_list_query_parses_exclude_participant_role() {
        let parsed: OfferListQuery = serde_urlencoded::from_str(
            "exclude_participant_script=52ac&exclude_participant_role=lender",
        )
        .expect("parse exclude role");
        assert_eq!(parsed.exclude_participant_script.as_deref(), Some("52ac"));
        assert_eq!(
            parsed.exclude_participant_role,
            Some(ParticipantType::Lender)
        );
    }

    #[test]
    fn offer_list_query_prepare_exclude_participant_defaults_role_to_borrower() {
        let mut query: OfferListQuery =
            serde_urlencoded::from_str("exclude_participant_script=52ac").expect("parse exclude");
        query
            .prepare_exclude_participant()
            .expect("prepare exclude");

        let (role, script) = query.exclude_participant_for_sql().expect("parsed exclude");
        assert_eq!(role, ParticipantType::Borrower);
        assert_eq!(script, &[0x52, 0xac]);
    }

    #[test]
    fn offer_list_query_prepare_exclude_participant_honors_role() {
        let mut query: OfferListQuery = serde_urlencoded::from_str(
            "exclude_participant_script=52ac&exclude_participant_role=lender",
        )
        .expect("parse exclude role");
        query
            .prepare_exclude_participant()
            .expect("prepare exclude");

        let (role, _) = query.exclude_participant_for_sql().expect("parsed exclude");
        assert_eq!(role, ParticipantType::Lender);
    }

    #[test]
    fn offer_list_query_prepare_exclude_participant_rejects_invalid_hex() {
        let mut query: OfferListQuery =
            serde_urlencoded::from_str("exclude_participant_script=zzzz").expect("parse exclude");
        assert!(query.prepare_exclude_participant().is_err());
    }

    #[test]
    fn offer_list_query_parses_not_expired_true() {
        let parsed: OfferListQuery =
            serde_urlencoded::from_str("not_expired=true").expect("parse not_expired");
        assert!(parsed.not_expired);
    }

    #[test]
    fn offer_list_query_defaults_not_expired_to_false() {
        let parsed: OfferListQuery = serde_urlencoded::from_str("").expect("parse empty query");
        assert!(!parsed.not_expired);
    }

    #[test]
    fn offer_list_query_rejects_invalid_not_expired_value() {
        let err = serde_urlencoded::from_str::<OfferListQuery>("not_expired=maybe");
        assert!(err.is_err());
    }
}
