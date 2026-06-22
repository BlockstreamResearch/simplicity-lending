use std::collections::HashMap;

use sqlx::{PgPool, Postgres, QueryBuilder};
use uuid::Uuid;

use simplex::simplicityhl::elements::hex::ToHex;

use crate::api::OfferListQuery;
use crate::api::query::{
    attach_latest_participant_offers_scope, attach_offer_list_filters, attach_offer_list_order_by,
    attach_paginate,
};
use crate::api::utils::format_hex;

use crate::models::{OfferModelShort, ParticipantType, UtxoType};

use super::dto::{OfferListItemShort, OfferListResponse, OfferUtxoOutpointShort, ParticipantShort};

const OFFERS_SHORT_LIST_SELECT: &str = r#"
    SELECT
        id,
        issuance_factory_id,
        current_status,
        collateral_asset_id,
        principal_asset_id,
        collateral_amount,
        principal_amount,
        interest_rate,
        loan_expiration_time,
        created_at_height,
        created_at_txid
    FROM offers
    WHERE 1=1
"#;

pub async fn fetch_all_offers_list(
    db: &PgPool,
    query: &OfferListQuery,
) -> Result<OfferListResponse, sqlx::Error> {
    fetch_paginated_short_offers(db, query, None).await
}

pub async fn fetch_participant_offers_list(
    db: &PgPool,
    query: &OfferListQuery,
    participant_type: ParticipantType,
    script_pubkey: &[u8],
) -> Result<OfferListResponse, sqlx::Error> {
    fetch_paginated_short_offers(db, query, Some((participant_type, script_pubkey))).await
}

#[tracing::instrument(
    name = "Fetching paginated short offers from DB",
    skip(db, query, participant),
    fields(
        limit = %query.effective_limit(),
        offset = %query.effective_offset(),
        status = ?query.status,
        collateral_asset = ?query.collateral_asset,
        principal_asset = ?query.principal_asset,
        factory_id = ?query.factory_id,
        sort_by = ?query.sort_by,
        sort_dir = ?query.sort_dir,
        participant_role = ?participant.map(|(role, _)| role),
    )
)]
async fn fetch_paginated_short_offers(
    db: &PgPool,
    query: &OfferListQuery,
    participant: Option<(ParticipantType, &[u8])>,
) -> Result<OfferListResponse, sqlx::Error> {
    let limit = query.effective_limit();
    let offset = query.effective_offset();

    let mut count_builder: QueryBuilder<Postgres> =
        QueryBuilder::new("SELECT COUNT(*)::BIGINT FROM offers WHERE 1=1");
    attach_offer_list_where(&mut count_builder, query, participant);
    let total: i64 = count_builder.build_query_scalar().fetch_one(db).await?;

    let mut query_builder: QueryBuilder<Postgres> = QueryBuilder::new(OFFERS_SHORT_LIST_SELECT);
    attach_offer_list_where(&mut query_builder, query, participant);
    attach_offer_list_order_by(&mut query_builder, query);
    attach_paginate(&mut query_builder, limit as i64, offset as i64);

    let rows = query_builder
        .build_query_as::<OfferModelShort>()
        .fetch_all(db)
        .await?;

    let mut items: Vec<OfferListItemShort> =
        rows.into_iter().map(OfferListItemShort::from).collect();
    enrich_offer_list_items(db, &mut items).await?;

    Ok(OfferListResponse {
        items,
        total: total as u64,
        limit,
        offset,
    })
}

fn attach_offer_list_where<'a>(
    query_builder: &mut QueryBuilder<'a, Postgres>,
    query: &'a OfferListQuery,
    participant: Option<(ParticipantType, &'a [u8])>,
) {
    if let Some((participant_type, script_pubkey)) = participant {
        attach_latest_participant_offers_scope(query_builder, participant_type, script_pubkey);
    }
    attach_offer_list_filters(query_builder, query);
}

#[derive(sqlx::FromRow)]
struct ParticipantListRow {
    offer_id: Uuid,
    participant_type: ParticipantType,
    script_pubkey: Vec<u8>,
}

#[derive(sqlx::FromRow)]
struct BorrowerPrincipalListRow {
    offer_id: Uuid,
    txid: Vec<u8>,
    vout: i32,
}

async fn enrich_offer_list_items(
    db: &PgPool,
    items: &mut [OfferListItemShort],
) -> Result<(), sqlx::Error> {
    if items.is_empty() {
        return Ok(());
    }

    let offer_ids: Vec<Uuid> = items.iter().map(|item| item.id).collect();

    let participant_rows = sqlx::query_as::<_, ParticipantListRow>(
        r#"
        SELECT DISTINCT ON (offer_id, participant_type)
            offer_id,
            participant_type,
            script_pubkey
        FROM offer_participants
        WHERE offer_id = ANY($1)
        ORDER BY offer_id, participant_type, created_at_height DESC
        "#,
    )
    .bind(&offer_ids)
    .fetch_all(db)
    .await?;

    let principal_rows = sqlx::query_as::<_, BorrowerPrincipalListRow>(
        r#"
        SELECT offer_id, txid, vout
        FROM offer_utxos
        WHERE spent_txid IS NULL
          AND utxo_type = $1
          AND offer_id = ANY($2)
        "#,
    )
    .bind(UtxoType::BorrowerPrincipal)
    .bind(&offer_ids)
    .fetch_all(db)
    .await?;

    let mut participants_by_offer: HashMap<Uuid, Vec<ParticipantShort>> = HashMap::new();
    for row in participant_rows {
        participants_by_offer
            .entry(row.offer_id)
            .or_default()
            .push(ParticipantShort {
                participant_type: row.participant_type,
                script_pubkey: row.script_pubkey.to_hex(),
            });
    }

    for participants in participants_by_offer.values_mut() {
        participants.sort_by_key(|participant| participant.participant_type);
    }

    let mut principal_by_offer: HashMap<Uuid, OfferUtxoOutpointShort> = HashMap::new();
    for row in principal_rows {
        principal_by_offer.insert(
            row.offer_id,
            OfferUtxoOutpointShort {
                txid: format_hex(row.txid),
                vout: row.vout as u32,
            },
        );
    }

    for item in items.iter_mut() {
        item.participants = participants_by_offer.remove(&item.id).unwrap_or_default();
        item.borrower_principal_utxo = principal_by_offer.remove(&item.id);
    }

    Ok(())
}
