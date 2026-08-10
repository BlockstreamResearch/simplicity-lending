# lending-contracts

SimplicityHL contracts and covenant logic for the Simplicity Lending protocol.

## Setup

Generated Rust artifacts under `src/artifacts` are gitignored. Create them before building or running external tools:

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

Output: `contract_sources.json` in the crate root.
