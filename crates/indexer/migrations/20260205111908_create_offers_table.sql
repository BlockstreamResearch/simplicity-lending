-- Add migration script here
CREATE TABLE offers(
    id uuid NOT NULL,
    PRIMARY KEY (id),
    txid BYTEA NOT NULL UNIQUE,
    created_at timestamptz NOT NULL
);