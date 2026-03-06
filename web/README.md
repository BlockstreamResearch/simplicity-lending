# Simplicity Lending — Web UI

Demo frontend for the Simplicity Lending protocol. Uses the [Indexer](../crates/indexer/README.md) REST API. See [repo root](../README.md) for full quick start.

## Prerequisites

- Node.js 18+
- [Indexer API](../crates/indexer/README.md) running (API mode, port 8000). The app uses `VITE_API_URL` (default `http://localhost:8000`); see `.env.example`.

> [!NOTE]
> `lwk_web` is a local file dependency. To build it: clone [Blockstream/lwk](https://github.com/Blockstream/lwk), then from the LWK repo run `cd lwk_wasm && RUSTFLAGS='--cfg web_sys_unstable_apis' wasm-pack build --target web --out-dir pkg_web --features simplicity,serial`. Update the `lwk_web` path in `package.json` to point to your `pkg_web` output directory.

## Setup

```bash
npm install
```

## Run

Start the Indexer API (see [crates/indexer/README.md](../crates/indexer/README.md); run from `crates/indexer` or repo root as documented there), then:

```bash
npm run dev
```

Open the URL shown (e.g. http://localhost:5173).

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Preview production build |
| `npm run lint` | ESLint |
| `npm run format` / `npm run format:check` | Prettier |
| `npm run test` | Vitest |
