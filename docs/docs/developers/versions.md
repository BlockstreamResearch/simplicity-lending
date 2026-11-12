---
description: The toolchain this repository is built and tested with.
---

# Versions

These are the versions the repository is built and tested with. [Build](./build.md) is where they are installed.

| Tool | Version |
| --- | --- |
| Rust | 1.91.0 or newer. CI also builds with stable. The Docker images use `rust:1.96`. The workspace edition is 2024. |
| Simplex | Commit [`1945d11`](https://github.com/BlockstreamResearch/smplx/commit/1945d11b47fff8838c3e99c210133519a9522324) of [smplx](https://github.com/BlockstreamResearch/smplx). The same commit is `SIMPLEX_COMMIT` in CI and in `deployment/Dockerfile.backend`. |
| sqlx-cli | 0.8.0, with the `rustls` and `postgres` features and the default features turned off. |
| Node.js | 20.19.0 or newer, for the web app. |
| pnpm | The web app and this site. This site pins pnpm 12.8.1. |
| PostgreSQL | 16 in both compose files. The indexer runs on 14 or newer, which is what CI uses. |
| nginx | 1.27, in the root compose file. |

Simplex is the compiler and test runner for the SimplicityHL sources in `crates/contracts/simf/`. It is a separate install from the Rust toolchain. [Simplicity](../simplicity.md) explains what those sources are.
