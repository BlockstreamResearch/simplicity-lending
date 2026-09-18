FROM rust:1.96-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev ca-certificates git && rm -rf /var/lib/apt/lists/*

# The contract crate's `artifacts` module is generated from simf/*.simf and is gitignored, so
# nothing in a checkout supplies it and `cargo build` fails on every contract at once. The
# generator is pinned to the same commit CI and deployment/Dockerfile.backend use; cargo resolves
# it, which avoids simplexup needing git >= 2.49 and jq.
ENV SIMPLEX_COMMIT=1945d11b47fff8838c3e99c210133519a9522324
RUN cargo install --locked --git https://github.com/BlockstreamResearch/smplx --rev "${SIMPLEX_COMMIT}" smplx-cli

WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY .sqlx ./.sqlx
COPY crates ./crates

# Generate the contract artifacts before compiling, and fail here rather than in the compiler if
# the generator produced nothing.
RUN cd crates/contracts \
    && simplex build \
    && test -f src/artifacts/mod.rs

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
