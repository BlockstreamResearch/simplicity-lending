use uuid::Uuid;

use crate::models::{OfferStatus, ParticipantType};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OfferSortBy {
    UpdatedAtHeight,
    CreatedAtHeight,
    CollateralAmount,
    PrincipalAmount,
    InterestRate,
    LoanExpirationHeight,
}

impl OfferSortBy {
    fn as_query_str(self) -> &'static str {
        match self {
            Self::UpdatedAtHeight => "updated_at_height",
            Self::CreatedAtHeight => "created_at_height",
            Self::CollateralAmount => "collateral_amount",
            Self::PrincipalAmount => "principal_amount",
            Self::InterestRate => "interest_rate",
            Self::LoanExpirationHeight => "loan_expiration_height",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SortDir {
    Asc,
    Desc,
}

impl SortDir {
    fn as_query_str(self) -> &'static str {
        match self {
            Self::Asc => "asc",
            Self::Desc => "desc",
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct OfferListParams {
    pub status: Vec<OfferStatus>,
    pub collateral_asset: Option<String>,
    pub principal_asset: Option<String>,
    pub factory_id: Option<Uuid>,
    pub exclude_participant_script: Option<String>,
    pub exclude_participant_role: Option<ParticipantType>,
    pub not_expired: bool,
    pub limit: Option<u64>,
    pub offset: Option<u64>,
    pub sort_by: Option<OfferSortBy>,
    pub sort_dir: Option<SortDir>,
}

impl OfferListParams {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_status(mut self, status: Vec<OfferStatus>) -> Self {
        self.status = status;
        self
    }

    pub fn with_collateral_asset(mut self, collateral_asset: impl Into<String>) -> Self {
        self.collateral_asset = Some(collateral_asset.into());
        self
    }

    pub fn with_principal_asset(mut self, principal_asset: impl Into<String>) -> Self {
        self.principal_asset = Some(principal_asset.into());
        self
    }

    pub fn with_factory_id(mut self, factory_id: Uuid) -> Self {
        self.factory_id = Some(factory_id);
        self
    }

    pub fn with_exclude_participant_script(mut self, script: impl Into<String>) -> Self {
        self.exclude_participant_script = Some(script.into());
        self
    }

    pub fn with_exclude_participant_role(mut self, role: ParticipantType) -> Self {
        self.exclude_participant_role = Some(role);
        self
    }

    pub fn with_not_expired(mut self, not_expired: bool) -> Self {
        self.not_expired = not_expired;
        self
    }

    pub fn with_limit(mut self, limit: u64) -> Self {
        self.limit = Some(limit);
        self
    }

    pub fn with_offset(mut self, offset: u64) -> Self {
        self.offset = Some(offset);
        self
    }

    pub fn with_sort(mut self, sort_by: OfferSortBy, sort_dir: SortDir) -> Self {
        self.sort_by = Some(sort_by);
        self.sort_dir = Some(sort_dir);
        self
    }

    pub(crate) fn to_query_pairs(&self) -> Vec<(&'static str, String)> {
        let mut pairs: Vec<(&'static str, String)> = Vec::new();

        if !self.status.is_empty() {
            let joined = self
                .status
                .iter()
                .map(|s| s.as_query_str())
                .collect::<Vec<_>>()
                .join(",");
            pairs.push(("status", joined));
        }

        if let Some(collateral_asset) = &self.collateral_asset {
            pairs.push(("collateral_asset", collateral_asset.clone()));
        }

        if let Some(principal_asset) = &self.principal_asset {
            pairs.push(("principal_asset", principal_asset.clone()));
        }

        if let Some(factory_id) = self.factory_id {
            pairs.push(("factory_id", factory_id.to_string()));
        }

        if let Some(script) = &self.exclude_participant_script {
            pairs.push(("exclude_participant_script", script.clone()));
        }

        if let Some(role) = self.exclude_participant_role {
            pairs.push(("exclude_participant_role", participant_role_query(role)));
        }

        if self.not_expired {
            pairs.push(("not_expired", "true".to_string()));
        }

        if let Some(limit) = self.limit {
            pairs.push(("limit", limit.to_string()));
        }

        if let Some(offset) = self.offset {
            pairs.push(("offset", offset.to_string()));
        }

        if let Some(sort_by) = self.sort_by {
            pairs.push(("sort_by", sort_by.as_query_str().to_string()));
        }

        if let Some(sort_dir) = self.sort_dir {
            pairs.push(("sort_dir", sort_dir.as_query_str().to_string()));
        }

        pairs
    }
}

fn participant_role_query(role: ParticipantType) -> String {
    match role {
        ParticipantType::Borrower => "borrower".to_string(),
        ParticipantType::Lender => "lender".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_params_produce_no_query_pairs() {
        assert!(OfferListParams::new().to_query_pairs().is_empty());
    }

    #[test]
    fn status_is_joined_with_commas() {
        let params =
            OfferListParams::new().with_status(vec![OfferStatus::Pending, OfferStatus::Active]);
        let pairs = params.to_query_pairs();
        assert_eq!(pairs, vec![("status", "pending,active".to_string())]);
    }

    #[test]
    fn pagination_and_sort_are_serialized() {
        let params = OfferListParams::new()
            .with_limit(10)
            .with_offset(5)
            .with_sort(OfferSortBy::LoanExpirationHeight, SortDir::Asc);
        let pairs = params.to_query_pairs();

        assert!(pairs.contains(&("limit", "10".to_string())));
        assert!(pairs.contains(&("offset", "5".to_string())));
        assert!(pairs.contains(&("sort_by", "loan_expiration_height".to_string())));
        assert!(pairs.contains(&("sort_dir", "asc".to_string())));
    }

    #[test]
    fn exclude_and_not_expired_filters_are_serialized() {
        let params = OfferListParams::new()
            .with_exclude_participant_script("52ac")
            .with_exclude_participant_role(ParticipantType::Lender)
            .with_not_expired(true)
            .with_sort(OfferSortBy::UpdatedAtHeight, SortDir::Desc);
        let pairs = params.to_query_pairs();

        assert!(pairs.contains(&("exclude_participant_script", "52ac".to_string())));
        assert!(pairs.contains(&("exclude_participant_role", "lender".to_string())));
        assert!(pairs.contains(&("not_expired", "true".to_string())));
        assert!(pairs.contains(&("sort_by", "updated_at_height".to_string())));
        assert!(pairs.contains(&("sort_dir", "desc".to_string())));
    }
}
