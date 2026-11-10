# Simplicity Lending Web

V2 frontend scaffold for the Simplicity Lending protocol.

## Prerequisites

- Node.js 20.19+
- pnpm 10+

## Environment Variables

Copy `.env.example` to `.env` and adjust as needed.

- `VITE_API_URL` - Base URL for the indexer API.
- `VITE_ESPLORA_BASE_URL` - Base URL for Esplora.
- `VITE_NETWORK` - Network name (`liquid`, `liquidtestnet`, `regtest`).

## Stack

- Vite + React + TypeScript
- Tailwind CSS v4 (token-ready theme scaffold)
- HeroUI (`@heroui/react`)
- React Router v7 (protected route stub)
- React Query v5
- Zod v3
- ESLint + Prettier

## Install

The app uses [LWK](https://github.com/Blockstream/lwk) from the `lwk` git submodule, pinned to one commit. Run from the repo root:

```bash
git submodule update --init lwk
git config submodule.recurse true
web/scripts/build-lwk.sh
cd web && pnpm install
```

`submodule.recurse` makes `git pull` update `lwk` too. If LWK changes after a pull, `pnpm dev` stops and tells you to run `pnpm lwk:build`.

The build needs Rust ([rustup](https://rustup.rs)), `cargo install wasm-pack --locked`, and on macOS `brew install llvm`. The script tells you if something is missing.

## Update LWK

```bash
cd lwk && git fetch origin && git checkout <commit> && cd ..
git add lwk
cd web && pnpm lwk:build
```

Then test the app and commit `lwk`. Pin a commit, don't follow a branch: `PsetBuilder` is experimental and can change.

## Run

```bash
pnpm dev
```

## Add Icon

Generate a new icon component in `src/components/icons`.

Command:

```bash
pnpm add-icon <icon-name> "<svg>...</svg>"
```

Example:

```bash
pnpm add-icon coins "<svg viewBox='0 0 24 24'>...</svg>"
```

Notes:

- If SVG content is omitted, the script reads SVG from your clipboard.
- The generated component is normalized to use `currentColor` and saved as `<name>-icon.tsx`.

## Lint

```bash
pnpm lint
```

## Docker

See [`deployment/`](../deployment/README.md) for the Docker build and compose stack.
