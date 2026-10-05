---
description: How to generate the contract artifacts and build the Rust workspace, the web app, and this site.
---

# Build

Install the toolchain from [Versions](./versions.md) first. The contract artifacts are generated before the Rust workspace will compile, because `lending-contracts` includes them and the directory is gitignored.

## Contracts

Simplex is installed with the installer from the Simplicity site, then pinned to the commit in [Versions](./versions.md):

```bash
curl -fsSL https://smplx.simplicity-lang.org | bash
~/.simplex/bin/simplexup --commit 1945d11b47fff8838c3e99c210133519a9522324
```

Add `~/.simplex/bin` to `PATH`. If `XDG_CONFIG_HOME` is set, the installer uses `$XDG_CONFIG_HOME/.simplex/bin` instead.

From `crates/contracts`:

```bash
simplex build
simplex test
```

`simplex build` writes `src/artifacts/` from the `.simf` sources. `simplex test` runs the contract tests. That is the check CI runs for this crate.

## Rust workspace

From the repository root, with the artifacts already generated:

```bash
SQLX_OFFLINE=true cargo check --workspace --locked
cargo clippy --workspace --all-targets --all-features -- -D warnings
```

`SQLX_OFFLINE=true` uses the checked-in `.sqlx` metadata, so this check does not need a running database. The indexer tests do. They are described in [Run locally](./local-setup.md).

The workspace members under `crates/` are the contracts, the session library that builds protocol transactions, the `lending-cli` binary, and the indexer. The indexer binary is `simplicity-lending-indexer`.

## Web app

From `web/`:

```bash
pnpm install
pnpm build
```

`pnpm build` typechecks the app and produces the Vite bundle. Running it against a local API is covered in [Run locally](./local-setup.md).

## This site

From `docs/`:

```bash
pnpm install
pnpm build
```

`pnpm start` serves the site while you edit it.
