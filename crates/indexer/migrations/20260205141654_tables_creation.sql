-- Add migration script here
CREATE TABLE sync_state (
    id INTEGER PRIMARY KEY DEFAULT 1,
    last_indexed_height BIGINT NOT NULL,
    last_indexed_hash TEXT NOT NULL,
    updated_at timestamptz DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT single_row CHECK (id = 1)
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

CREATE TYPE utxo_type AS ENUM (
    'pre-lock',
    'lending',
    'cancellation',
    'repayment',
    'liquidation',
    'claim'
);

CREATE TABLE offer_utxos (
    offer_id uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
    txid BYTEA NOT NULL,
    vout INTEGER NOT NULL,
    PRIMARY KEY (txid, vout),
    utxo_type utxo_type NOT NULL DEFAULT 'pre-lock',
    created_at_height BIGINT NOT NULL,
    spent_txid BYTEA,
    spent_at_height BIGINT
);

CREATE INDEX idx_offer_utxos_unspent 
ON offer_utxos (txid, vout) 
WHERE spent_txid IS NULL;
