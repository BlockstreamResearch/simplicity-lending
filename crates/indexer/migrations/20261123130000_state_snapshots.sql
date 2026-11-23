-- Row state before its first in-place update at `height`, used to roll the block back.
CREATE TABLE offer_state_snapshots (
    height BIGINT NOT NULL,
    offer_id BIGINT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
    current_status offer_status NOT NULL,
    current_debt BIGINT NOT NULL,
    collateral_remaining BIGINT NOT NULL,
    updated_at_height BIGINT NOT NULL,
    PRIMARY KEY (height, offer_id)
);

CREATE TABLE factory_state_snapshots (
    height BIGINT NOT NULL,
    factory_id uuid NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
    current_status factory_status NOT NULL,
    PRIMARY KEY (height, factory_id)
);
