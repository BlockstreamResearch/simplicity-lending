# Lending Harvester

Collects protocol fees from finalized offer vaults (via the indexer) into a single fee collector UTXO, and withdraws the accumulated fees to a given address.

## Setup

Create and fill in `.env` (see `.env.example`):

```
HARVESTER_HARVEST__MNEMONIC=             (wallet paying harvest tx fees)
HARVESTER_WITHDRAW__MNEMONIC=            (wallet signing withdrawals)
HARVESTER_COLLECTOR__WITHDRAW_PUBKEY=    (x-only pubkey (hex) allowed to withdraw)
HARVESTER_WITHDRAW__DESTINATION_ADDRESS= (Liquid address receiving fees)
```

Edit `configuration/base.yaml` if needed.

## Run

Run the indexer first.

Scheduled harvest loop:

```bash
cargo run --release -- run
```

Single harvest pass:

```bash
cargo run --release -- harvest
```

Withdraw from the fee collector (destination from `.env`, or override with `--to`):

```bash
cargo run --release -- withdraw
cargo run --release -- withdraw --to <ADDRESS>
```

Harvester state is kept in `state.json`.
