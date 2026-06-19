use serde::Deserialize;

use crate::api::params::OfferFilters;
use crate::api::params::ScriptQuery;

/// Query parameters for `GET /borrowers/overview`.
pub type BorrowerOverviewQuery = ScriptQuery;

/// Query parameters for `GET /borrowers/offers`: wallet script plus offer-list filters.
#[derive(Deserialize, Debug)]
pub struct BorrowerOffersQuery {
    pub script_pubkey: String,
    #[serde(flatten)]
    pub filters: OfferFilters,
}

#[cfg(test)]
mod tests {
    use super::BorrowerOffersQuery;

    #[test]
    fn borrower_offers_query_parses_flat_pagination() {
        let parsed: BorrowerOffersQuery = serde_urlencoded::from_str(
            "script_pubkey=0014d0c4a3ef09e887b6e99e397e518fe3e41a118ca1&limit=10",
        )
        .expect("parse borrower offers query");

        assert_eq!(
            parsed.script_pubkey,
            "0014d0c4a3ef09e887b6e99e397e518fe3e41a118ca1"
        );
        assert_eq!(parsed.filters.limit, Some(10));
    }
}
