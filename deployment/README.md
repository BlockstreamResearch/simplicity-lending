# Dockerized Simplicity Lending Deployment

This deployment stack runs:

- `postgres` for indexed state
- `migrate` to apply the SQLx schema before the app starts
- `api` for the lending protocol HTTP API
- `indexer` for background chain indexing
- `web` for the public frontend, including `/api` and `/esplora` reverse proxies

## Layout

Most deployment knobs live in `deployment/configs`:

- `compose.env.example`: the single env file template for compose and runtime rendering
- `backend/*.template`: rendered into the indexer `configuration/` directory
- `nginx/default.conf.template`: reverse proxy and SPA serving rules
- `web/runtime-config.js.template`: browser runtime config injected at container start

## Quick Start

From `deployment/`:

```bash
cp ./configs/compose.env.example ./configs/compose.env
docker compose --env-file ./configs/compose.env -f docker-compose.yml up --build -d
```

The stack publishes only the web container on `WEB_PORT`. The browser calls:

- `/api/*` -> internal `api:8000`
- `/esplora/*` -> `${WEB_ESPLORA_API_UPSTREAM}`

That same-origin shape avoids browser CORS issues for normal deployment.

## Required Configuration

Set these values in `deployment/configs/compose.env`:

- `PUBLIC_ORIGIN`: the final public HTTPS origin, for example `https://lending.example.com`
- `WEB_PORT`: host port mapped to the public web server
- `REOWN_PROJECT_ID`: the Reown / WalletConnect project id used by the browser
- `WALLET_ABI_NETWORK`: `liquid`, `testnet-liquid`, or `localtest-liquid`
- `API_CORS_ALLOWED_ORIGINS`: a YAML inline list, for example `["https://lending.example.com"]`
- `INDEXER_ESPLORA_BASE_URL`: the Esplora API used by the backend indexer
- `WEB_ESPLORA_API_UPSTREAM`: the Esplora API proxied by nginx, for example `https://blockstream.info/liquidtestnet/api`
- `WEB_ESPLORA_EXPLORER_URL`: the explorer UI base used for transaction links, for example `https://blockstream.info/liquidtestnet`
- `INDEXER_POLL_INTERVAL_MS`: background polling interval
- `INDEXER_LAST_INDEXED_HEIGHT`: first height to index from
- `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`: database connection settings

## WalletConnect / Reown Notes

WalletConnect is browser-originated. Your server does not terminate WalletConnect sessions or relay traffic. The web app serves the JavaScript, and the browser talks directly to Reown / WalletConnect infrastructure.

Important deployment constraints:

- `PUBLIC_ORIGIN` should be the exact HTTPS origin users open in the browser.
- That same origin must be allowlisted in your Reown project settings.
- Wallet metadata is built from `window.location.origin`, so the externally visible host and scheme must be correct at the edge.
- The app now uses `/vite.svg` as the WalletConnect metadata icon, so that asset must stay publicly reachable.
- Corporate proxies, VPNs, privacy extensions, or firewalls can block the WalletConnect relay. If pairing fails, test browser access without those layers first.
- WalletConnect depends on secure browser context behavior. Treat plain HTTP as local-dev only.

Official references:

- [Reown AppKit Installation](https://docs.reown.com/appkit/javascript/core/installation)
- [Reown AppKit FAQ](https://docs.reown.com/appkit/faq)
- [WalletConnect Relay](https://docs.walletconnect.network/wallet-sdk/web/cloud/relay)

## CORS, Proxying, and Other Deployment Pitfalls

- The default deployment keeps the API private and exposes it through nginx as `/api`. In that shape, browser CORS is mostly avoided.
- The backend still has explicit CORS configuration. Keep `API_CORS_ALLOWED_ORIGINS` aligned with `PUBLIC_ORIGIN`.
- If you expose the API on a separate origin, you must widen `API_CORS_ALLOWED_ORIGINS` and set the frontend runtime config to use that different API base instead of `/api`.
- The frontend also makes browser-side Esplora calls. Keeping `/esplora` on the same origin avoids a second CORS surface.
- This deployment assumes the app is served from a domain root, not a subpath. If you need a subpath deployment, you will need additional Vite base-path work.

## Useful Commands

From `deployment/`:

```bash
docker compose --env-file ./configs/compose.env -f docker-compose.yml config
docker compose --env-file ./configs/compose.env -f docker-compose.yml build
docker compose --env-file ./configs/compose.env -f docker-compose.yml up -d
docker compose --env-file ./configs/compose.env -f docker-compose.yml logs -f web api indexer
docker compose --env-file ./configs/compose.env -f docker-compose.yml down
```

## Smoke Checks

Once the stack is running, verify:

- `http://localhost:${WEB_PORT}/`
- `http://localhost:${WEB_PORT}/runtime-config.js`
- `http://localhost:${WEB_PORT}/api/offers?limit=1`
- `http://localhost:${WEB_PORT}/esplora/blocks/tip/height`
