use sqlx::{Postgres, QueryBuilder};

use crate::api::OfferListQuery;
use crate::api::utils::parse_filter_hex;
use crate::models::OfferStatus;

pub fn attach_status_any<'a>(
    query_builder: &mut QueryBuilder<'a, Postgres>,
    statuses: &'a [OfferStatus],
) {
    if statuses.is_empty() {
        return;
    }
    query_builder.push(" AND current_status = ANY(");
    query_builder.push_bind(statuses);
    query_builder.push(")");
}

pub fn attach_offer_list_filters<'a>(
    query_builder: &mut QueryBuilder<'a, Postgres>,
    query: &'a OfferListQuery,
) {
    if !query.status.is_empty() {
        attach_status_any(query_builder, &query.status);
    }

    if let Some(factory_id) = query.factory_id {
        query_builder.push(" AND issuance_factory_id = ");
        query_builder.push_bind(factory_id);
    }

    if let Some(collateral_asset_hex) = &query.collateral_asset {
        if let Some(bin) = parse_filter_hex(collateral_asset_hex) {
            query_builder.push(" AND collateral_asset_id = ");
            query_builder.push_bind(bin);
        } else {
            tracing::warn!(
                collateral_asset_hex,
                "Failed to decode collateral_asset hex filter"
            );
        }
    }

    if let Some(principal_asset_hex) = &query.principal_asset {
        if let Some(bin) = parse_filter_hex(principal_asset_hex) {
            query_builder.push(" AND principal_asset_id = ");
            query_builder.push_bind(bin);
        } else {
            tracing::warn!(
                principal_asset_hex,
                "Failed to decode principal_asset hex filter"
            );
        }
    }
}
