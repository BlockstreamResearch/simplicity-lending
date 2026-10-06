---
description: Run Postgres, the indexer, the API, and the web app on the host.
---

# Run locally

This runs the demo without the Compose stack: a database, the indexer, the API, and the web app. Install the toolchain from [Versions](./versions.md) and generate the contract artifacts as [Build](./build.md) describes. The same API can instead come from [Docker](./docker.md), in which case skip to the web app and point it at `http://localhost:8000`.

## Database

Install sqlx-cli:

```bash
cargo install sqlx-cli --version 0.8.0 --no-default-features --features rustls,postgres
```

From `crates/indexer`, with Docker available:

```bash
./scripts/init_db.sh
```

The script starts Postgres, creates the `lending-indexer` database, and runs the migrations. The connection string it migrates with is `postgres://app:secret@localhost:5432/lending-indexer`. Write that to `crates/indexer/.env` as `DATABASE_URL`. sqlx reads it when the indexer is compiled against a live database.

`SKIP_DOCKER=true ./scripts/init_db.sh` migrates a Postgres that is already listening on port 5432.

The process itself reads `configuration/`. The local environment, which is the default, listens on `127.0.0.1` port 8000 and connects as the `postgres` user from `configuration/base.yaml`. The script's Postgres superuser is `postgres` with password `password`, so that connection matches a database the script just created.

## Indexer and API

Run both commands from `crates/indexer`, so the configuration directory is found. Each is its own process:

```bash
RUN_MODE=api cargo run -p lending-indexer
RUN_MODE=indexer cargo run -p lending-indexer
```

`RUN_MODE` defaults to `api`, so a bare `cargo run -p lending-indexer` serves the API and does no indexing. The worker is what watches Liquid testnet and writes offers into the database. Its Esplora URL, network, and the first height it reads are `esplora` and `indexer.last_indexed_height` in `configuration/base.yaml`.

The API is at `http://localhost:8000`. Swagger UI is at `http://localhost:8000/swagger-ui/`. A request path on this port is the handler path, such as `/offers`.

Indexer tests use the migrated database:

```bash
DATABASE_URL=postgres://app:secret@localhost:5432/lending-indexer cargo test -p lending-indexer
```

## Web app

From `web/`, copy `.env.example` to `.env`. The template sets `VITE_API_URL` to `http://localhost:8000`, which is this API. `VITE_NETWORK` in the template is `liquid`. For the testnet demo, set it to `liquidtestnet` and point `VITE_ESPLORA_BASE_URL` at the testnet explorer. `.env.liquidtestnet` is a starting point for that.

```bash
pnpm install
pnpm dev
```

Open the address Vite prints. `VITE_DEMO_MODE` and `VITE_DEBUG_MNEMONIC` in the example file are for a local testnet session.
