CREATE TABLE indexed_blocks (
    height BIGINT PRIMARY KEY,
    hash TEXT NOT NULL,
    -- false: the block was indexed before undo data was recorded and cannot be rolled back.
    revertible BOOLEAN NOT NULL
);

INSERT INTO indexed_blocks (height, hash, revertible)
SELECT last_indexed_height, last_indexed_hash, false
FROM sync_state;
