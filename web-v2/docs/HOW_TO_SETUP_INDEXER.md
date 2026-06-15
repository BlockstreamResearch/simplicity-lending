# Indexer / Backend Setup

## Install dependencies

### Install cargo

```bash
curl https://sh.rustup.rs -sSf | sh

cargo --version
```

### Install simplex

```bash
git clone https://github.com/BlockstreamResearch/smplx.git
cd smplx

git checkout v0.0.5

cargo install --path crates/cli

simplex --version # Simplex 0.0.5
```

## Checkout the `dev` branch

```bash
git checkout dev
```

## Make sure you have .env file in the root

From repo root:

```bash
cp .env.example .env
```

## Build contracts

From repo root:

```bash
cd crates/contracts

simplex build
cargo build
```

## Run docker compose

From repo root:

```bash
docker compose up -d
```

After this, the indexer should be available at http://localhost:80
