# lending-contracts

SimplicityHL contracts and covenant logic for the Simplicity Lending protocol.

## Setup

Generated Rust artifacts under `src/artifacts` are gitignored. Create them before building or running examples:

```bash
cd crates/contracts
simplex install
simplex build
```

## Export contract sources

Generate a JSON map of compiled contract `SOURCE` strings:

```bash
cargo run -p lending-contracts --example export_contract_sources
```

Output: `src/artifacts/contract_sources.json`.
