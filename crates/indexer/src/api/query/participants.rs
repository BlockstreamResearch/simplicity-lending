use sqlx::{Postgres, QueryBuilder};

use crate::models::ParticipantType;

enum ParticipantScopeMode {
    Include,
    Exclude,
}

pub fn attach_latest_participant_offers_scope<'a>(
    query_builder: &mut QueryBuilder<'a, Postgres>,
    participant_type: ParticipantType,
    script_pubkey: &'a [u8],
) {
    attach_participant_script_scope(
        query_builder,
        ParticipantScopeMode::Include,
        participant_type,
        script_pubkey,
    );
}

pub fn attach_exclude_participant_script_scope<'a>(
    query_builder: &mut QueryBuilder<'a, Postgres>,
    participant_type: ParticipantType,
    script_pubkey: &'a [u8],
) {
    attach_participant_script_scope(
        query_builder,
        ParticipantScopeMode::Exclude,
        participant_type,
        script_pubkey,
    );
}

fn attach_participant_script_scope<'a>(
    query_builder: &mut QueryBuilder<'a, Postgres>,
    mode: ParticipantScopeMode,
    participant_type: ParticipantType,
    script_pubkey: &'a [u8],
) {
    match mode {
        ParticipantScopeMode::Include => {
            query_builder.push(" AND id IN (");
        }
        ParticipantScopeMode::Exclude => {
            query_builder.push(" AND id NOT IN (");
        }
    }
    query_builder.push(
        "SELECT offer_id FROM (
            SELECT DISTINCT ON (offer_id) offer_id, script_pubkey
            FROM offer_participants
            WHERE participant_type = ",
    );
    query_builder.push_bind(participant_type);
    query_builder.push(
        " ORDER BY offer_id, created_at_height DESC
        ) latest_participant WHERE script_pubkey = ",
    );
    query_builder.push_bind(script_pubkey);
    query_builder.push(")");
}
