-- Ids of offers removed by a block rollback, reused when the same creation tx is indexed again.
CREATE TABLE offer_id_reservations (
    created_at_txid BYTEA PRIMARY KEY,
    offer_id BIGINT NOT NULL UNIQUE
);
