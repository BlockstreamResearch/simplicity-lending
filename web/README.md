# Simplicity Lending — Web UI

WalletConnect frontend for the Simplicity Lending protocol. The browser no longer derives keys or holds a seed. It connects to a wallet through the Wallet ABI namespace, uses the indexer for public protocol state, and only shows balances that are public from chain/indexer data.

## Prerequisites

- Node.js 18+
- [Indexer API](../crates/indexer/README.md) running (API mode, port 8000). The app uses `VITE_API_URL` (default `http://localhost:8000`); see `.env.example`.
- A [Reown](https://reown.com/) project id configured through `VITE_REOWN_PROJECT_ID`.

> [!NOTE]
> `lwk_web` is a local file dependency. To build it: clone [Blockstream/lwk](https://github.com/Blockstream/lwk), then from the LWK repo run `cd lwk_wasm && RUSTFLAGS='--cfg web_sys_unstable_apis' wasm-pack build --target web --out-dir pkg_web --features simplicity,serial`. Update the `lwk_web` path in `package.json` to point to your `pkg_web` output directory.

## Environment

Copy `web/.env.example` into a local `.env` and set:

- `VITE_API_URL` for the lending indexer
- `VITE_REOWN_PROJECT_ID` for the official WalletConnect transport
- `VITE_WALLET_ABI_NETWORK` for `liquid`, `testnet-liquid`, or `localtest-liquid`
- `VITE_ESPLORA_BASE_URL` and optionally `VITE_ESPLORA_EXPLORER_URL` for chain lookups and explorer links

## Setup

```bash
npm install
```

## Run

Start the indexer, then:

```bash
npm run dev
```

Open the URL shown (for example `http://localhost:5173`), connect the wallet, and approve the WalletConnect pairing in the wallet app. Existing WalletConnect sessions restore automatically on reload, and stale Wallet ABI sessions for this app are disconnected during startup.

## Supported Flow

The web app exposes only the protocol surfaces:

- `Dashboard`
- `Borrower`
- `Lender`

The app uses only these wallet JSON-RPC methods:

- `get_signer_receive_address`
- `get_raw_signing_x_only_pubkey`
- `wallet_abi_process_request`

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Preview production build |
| `npm run lint` | ESLint |
| `npm run format` / `npm run format:check` | Prettier |
| `npm run test` | Vitest |
