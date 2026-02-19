# Simplicity covenants (web)

- **sources/** — The only covenant source kept in web: `p2pk.simf` (P2PK program from simplicityhl-core). All other covenant sources are read at build time from `crates/contracts/` via paths in **`web/simplicity-covenants.config.json`** (paths relative to repo root).
- **sources.ts** — Registry: `getSource(id)`, `listCovenantIds()`. Sources are loaded by the Vite plugin from the config; no copying step.
- **lwk.ts** — LWK wasm init and wrappers (e.g. `createP2trAddress({ source, args, internalKey, network })`).
- **index.ts** — Re-exports for the rest of the app.

To add a covenant: add an entry to `web/simplicity-covenants.config.json` (path from repo root). For a new contract in crates, use path like `crates/contracts/src/<name>/source_simf/<name>.simf`.
