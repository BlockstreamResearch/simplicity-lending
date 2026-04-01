FROM rust:1.90-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY .sqlx ./.sqlx
COPY crates ./crates

RUN SQLX_OFFLINE=true cargo build --locked --release -p lending-indexer --bin simplicity-lending-indexer

FROM builder AS sqlx-builder
RUN cargo install --locked sqlx-cli --no-default-features --features rustls,postgres

FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends bash ca-certificates libssl3 nodejs npm && rm -rf /var/lib/apt/lists/*
RUN npm install --global --no-fund --no-update-notifier bunyan
RUN useradd --system --create-home --uid 10001 appuser

WORKDIR /app
COPY --from=builder /app/target/release/simplicity-lending-indexer /usr/local/bin/simplicity-lending-indexer
COPY crates/indexer/configuration/ configuration/

USER appuser
CMD ["bash", "-o", "pipefail", "-c", "simplicity-lending-indexer 2>&1 | bunyan"]

FROM debian:bookworm-slim AS migrate

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libssl3 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=sqlx-builder /usr/local/cargo/bin/sqlx /usr/local/bin/sqlx
COPY crates/indexer/migrations/ migrations/

CMD ["sqlx", "migrate", "run"]
