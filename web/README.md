# Simplicity Lending — Web UI

Demo frontend for the Simplicity Lending protocol. Uses the [Indexer](../crates/indexer/README.md) REST API. See [repo root](../README.md) for full quick start.

## Prerequisites

- Node.js 18+
- [Indexer API](../crates/indexer/README.md) running (API mode, port 8000). The app uses `VITE_API_URL` (default `http://localhost:8000`); see `.env.example`.
- A valid WalletConnect Project ID in `VITE_WALLETCONNECT_PROJECT_ID`
- Local Wallet ABI packages built under:
  - `/Volumes/Somebody/Desktop/Simp/lwk/lwk_wasm/npm/packages/wallet-abi-sdk`
  - `/Volumes/Somebody/Desktop/Simp/lwk/lwk_wasm/npm/packages/wallet-abi-web`

## Setup

```bash
npm install
```

Create `web/.env.local` for local-only overrides. The tracked `.env.example` stays generic; local builds should place the WalletConnect project id in `.env.local`.

## Run

Start the Indexer API (see [crates/indexer/README.md](../crates/indexer/README.md); run from `crates/indexer` or repo root as documented there), then:

```bash
npm run dev
```

Open the URL shown (e.g. http://localhost:5173).

Connect with the Blockstream app from the browser UI. The web app now uses Wallet ABI requests over WalletConnect instead of a browser-stored seed signer.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Preview production build |
| `npm run lint` | ESLint |
| `npm run format` / `npm run format:check` | Prettier |
| `npm run test` | Vitest |
