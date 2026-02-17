# Simplicity Lending Indexer and API

This crate serves as a specialized indexer for a Simplicity-based P2P lending protocol. It is designed to discover lending offers, monitor their state transitions, and track participants throughout the entire lifecycle of a loan.

## Features

- [x] Real-time detection of transactions initializing lending offers based on Simplicity covenants.
- [x] Continuous monitoring of offer transitions (e.g., from `Active` to `Repaid`, `Liquidated`) by analyzing UTXO consumption.
- [x] Dynamic tracking of `Borrower` and `Lender` participants by monitoring the movement of role-defining NFTs.
- [x] A robust interface designed for seamless frontend integration with batch processing support.
- [ ] Aggregated data engine for generating financial metrics (TVL, volume, average interest rates) to power dashboard visualizations.

## Architecture

The indexer consists of two core components: the Indexing Engine (background worker) and a REST API for seamless data retrieval.

### Indexing Engine & Pipeline

#### Background Worker Responsibilities

The background worker continuously monitors the Liquid Network to ensure the database remains synchronized with the blockchain state. Its primary duties include:
1. Identifying transactions that initialize new lending offers (`PreLock` covenants).
2. Tracking UTXOs belonging to active offers to trigger status updates (e.g., transitions from `Active` to `Repaid` or `Liquidated`).
3. Monitoring the movement of `Borrower` and `Lender` NFTs to maintain up-to-date information on current offer participants.

#### The Standard Indexing Pipeline

For every block height, the engine executes the following steps:
1. Fetches the block hash for the target height via the Esplora API.
2. Retrieves all transaction identifiers (TXIDs) associated with that block.
3. Fetches full transaction data for each TXID.
4. For every transaction input, the engine performs the following checks in order:
    - If an input spends an active output belonging to an existing offer, the engine processes a state transition.
    - If an input spends a participant-related output (NFT), the engine updates the participant registry for the associated offer.
    - If no existing state matches are found, the transaction is evaluated as a potential offer creation.

#### `PreLock` Transaction Detection Rules

To identify transactions creating `PreLock` covenants, the engine applies a strict validation sequence:
1. Attempts to parse `PreLockArguments` from the transaction. This validates the number of inputs/outputs, the presence of required `OP_RETURN` metadata, and correct parameters encoding.
2. Uses the extracted `PreLockArguments` to derive the expected `PreLock` covenant address.
3. Compares the derived address against the `script_pubkey` of the **0-th** output. If they match, the transaction is indexed as a valid new offer.

### API Service

The API is implemented as a REST service built with `Axum`, leveraging `PostgreSQL` and `SQLx` for asynchronous, type-safe persistence. It features integrated `tracing` to provide structured logging and comprehensive request monitoring out of the box.

## Getting started

Follow these steps to get the indexer up and running in your local environment.

### Prerequisites

- Rust: Latest stable version (e.g., 1.90+)
- PostgreSQL: Version 14 or higher
- sqlx-cli: Required for database management and compile-time query validation

```bash
cargo install sqlx-cli --no-default-features --features postgres
```

### Configuration

Create a `.env` file in the root directory with your database connection string. This is required for sqlx compile-time validation and runtime connectivity.

```bash
DATABASE_URL=postgres://username:password@localhost:5432/indexer_db
```

Application settings are managed via YAML files in the `configuration/` folder (e.g., `base.yaml`, `local.yaml`).

```yaml
# Example configuration structure
application:
  port: 8000
  host: 127.0.0.1
database:
  host: "localhost"
  port: 5432
  username: "postgres"
  password: "password"
  database_name: "lending-indexer"
esplora:
  base_url: "https://blockstream.info/liquidtestnet/api"
  timeout: 10
indexer:
  interval: 10000
  start_height: 2309541
```

> [!TIP]
> If `sqlx` fails to detect the `DATABASE_URL` environment variable while you are using VS Code with the `rust-analyzer` extension, you may need to restart the extension or the editor itself to refresh the environment context.

### Database Setup

The easiest way to initialize the environment is using the provided setup script. It automatically launches a Postgres container, creates the application user, and runs migrations.

Make sure Docker is running, then execute:
```bash
chmod +x scripts/init_db.sh
./scripts/init_db.sh
```
If you already have a database running and want to skip Docker, use:
```bash
SKIP_DOCKER=true ./scripts/init_db.sh
```

### Running the Project

Commands must be executed from the root directory of the crate. The application supports two execution modes via the `RUN_MODE` environment variable:
- `indexer`: Starts the blockchain indexing background worker.
- `api`: Starts the REST API service (Default).

To start the Indexer:
```bash
RUN_MODE=indexer cargo run -p lending-indexer
```

To start the API Service:
```bash
RUN_MODE=api cargo run -p lending-indexer
# Or simply (defaults to API)
cargo run -p lending-indexer
```

> [!TIP]
> For readable, pretty-printed logs in your console, pipe the output to bunyan. If you don't have it installed, run `cargo install bunyan`:
> ```bash
> RUN_MODE=indexer cargo run -p lending-indexer | bunyan
> ```

## Development & Testing

### Code Quality
To ensure code consistency and catch common issues, we use `clippy` and `rustfmt`.

Linting:
```bash
cargo clippy -- -D warnings
```

Formatting:
```bash
cargo fmt --all
```

### Running Tests

Ensure your local database is available and migrated, then run:

```bash
cargo test -p lending-indexer
```

### SQLx Offline Mode

To build the project or run checks without a live database (e.g., in CI/CD), use the `.sqlx` metadata.

Prepare metadata:
```bash
cargo sqlx prepare --workspace -- --all-targets
```

Verify without DB:
```bash
SQLX_OFFLINE=true cargo check
```

## API Reference

### Filtering Parameters (Query Params)

The following parameters are available for `/offers` and `/offers/full` endpoints:
- `status`: Filter by offer state (`ACTIVE`, `REPAID`, `LIQUIDATED`, `CANCELLED`).
- `asset`: Hex identifier of the asset (matches either collateral or principal asset).
- `limit`: Maximum number of records to return (default: 50).
- `offset`: Pagination offset (default: 0).

### Offers Endpoints

| Method | Endpoint | Description | Params / Body |
| :--- | :--- | :--- | :--- |
| `GET` | `/offers` | Get list of offers with short information | `status`, `asset`, `limit`, `offset` |
| `GET` | `/offers/full` | Get list of offers with full information | `status`, `asset`, `limit`, `offset` |
| `GET` | `/offers/by-script` | Find offer IDs by `script_pubkey` | `script_pubkey` (query param) |
| `POST` | `/offers/batch` | Get detailed information for multiple offers | JSON Body (list of UUIDs in `ids` field) |
| `GET` | `/offers/{id}` | Get comprehensive details for a single offer | — |
| `GET` | `/offers/{id}/participants` | Get the latest (current) participants of an offer | — |
| `GET` | `/offers/{id}/participants/history` | Get the full history of all participants | — |
| `GET` | `/offers/{id}/utxos` | Get the history of UTXOs associated with an offer | — |
