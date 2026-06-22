use sqlx::{Postgres, QueryBuilder};

use crate::api::{OfferListQuery, SortDir};

pub fn attach_offer_list_order_by(
    query_builder: &mut QueryBuilder<Postgres>,
    query: &OfferListQuery,
) {
    query_builder.push(" ORDER BY ");
    query_builder.push(query.sort_by.sql_column());
    query_builder.push(match query.sort_dir {
        SortDir::Asc => " ASC",
        SortDir::Desc => " DESC",
    });
}

pub fn attach_paginate(query_builder: &mut QueryBuilder<Postgres>, limit: i64, offset: i64) {
    query_builder.push(" LIMIT ");
    query_builder.push_bind(limit);
    query_builder.push(" OFFSET ");
    query_builder.push_bind(offset);
}
