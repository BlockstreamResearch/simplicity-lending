use serde::Deserialize;

use crate::api::params::OfferFilters;

/// Borrower dashboard query: wallet script plus offer-list filters (flat query string).
#[derive(Deserialize, Debug)]
pub struct BorrowerDashboardQuery {
    pub script_pubkey: String,
    #[serde(flatten)]
    pub filters: OfferFilters,
}

#[cfg(test)]
mod tests {
    use super::BorrowerDashboardQuery;

    #[test]
    fn borrower_dashboard_query_parses_flat_pagination() {
        let parsed: BorrowerDashboardQuery = serde_urlencoded::from_str(
            "script_pubkey=0014d0c4a3ef09e887b6e99e397e518fe3e41a118ca1&limit=10",
        )
        .expect("parse borrower dashboard query");

        assert_eq!(
            parsed.script_pubkey,
            "0014d0c4a3ef09e887b6e99e397e518fe3e41a118ca1"
        );
        assert_eq!(parsed.filters.limit, Some(10));
    }
}
