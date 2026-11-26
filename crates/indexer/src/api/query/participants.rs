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

/// Offers whose latest participant of `participant_type` (highest `id`) holds `script_pubkey`.
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
        "SELECT participant.offer_id
        FROM offer_participants participant
        WHERE participant.participant_type = ",
    );
    query_builder.push_bind(participant_type);
    query_builder.push(" AND participant.script_pubkey = ");
    query_builder.push_bind(script_pubkey);
    query_builder.push(
        " AND NOT EXISTS (
            SELECT 1
            FROM offer_participants newer
            WHERE newer.offer_id = participant.offer_id
              AND newer.participant_type = participant.participant_type
              AND newer.id > participant.id
        ))",
    );
}
