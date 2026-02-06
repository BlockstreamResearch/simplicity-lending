-- Add migration script here
CREATE TABLE sync_state (
    id INTEGER PRIMARY KEY DEFAULT 1,
    last_indexed_height BIGINT NOT NULL,
    last_indexed_hash TEXT NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT single_row CHECK (id = 1)
);

CREATE TABLE blocks_log (
    height BIGINT PRIMARY KEY,
    block_hash TEXT NOT NULL,
    tx_count INTEGER NOT NULL,
    indexed_at timestamptz DEFAULT CURRENT_TIMESTAMP
);

CREATE TYPE offer_status AS ENUM (
    'pending',
    'active',
    'repaid',
    'liquidated',
    'cancelled',
    'claimed'
);

CREATE TABLE offers (
    id uuid NOT NULL,
    PRIMARY KEY (id),
    borrower_pub_key BYTEA NOT NULL,
    collateral_asset_id BYTEA NOT NULL,
    principal_asset_id BYTEA NOT NULL,
    first_parameters_nft_asset_id BYTEA NOT NULL,
    second_parameters_nft_asset_id BYTEA NOT NULL,
    borrower_nft_asset_id BYTEA NOT NULL,
    lender_nft_asset_id BYTEA NOT NULL,
    collateral_amount BIGINT NOT NULL,
    principal_amount BIGINT NOT NULL,
    interest_rate INTEGER NOT NULL,
    loan_expiration_time INTEGER NOT NULL,
    current_status offer_status NOT NULL DEFAULT 'pending',
    created_at_height BIGINT NOT NULL,
    created_at_txid BYTEA NOT NULL UNIQUE
);