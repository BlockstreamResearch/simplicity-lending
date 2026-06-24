# Dockerized Simplicity Lending Deployment

This deployment stack runs:

- `postgres` for indexed state
- `migrate` to apply the SQLx schema before the app starts
- `api` for the lending protocol HTTP API
- `indexer` for background chain indexing
- `web` for the public `web-v2` frontend, including `/api` and `/esplora` reverse proxies

## Layout

Most deployment knobs live in `deployment/configs`:

- `compose.env.example`: the single env file template for compose, image build args, and runtime rendering
- `backend/*.template`: rendered into the indexer `configuration/` directory
- `nginx/default.conf.template`: reverse proxy and SPA serving rules

## Quick Start

From `deployment/`:

```bash
cp ./configs/compose.env.example ./configs/compose.env
docker compose --env-file ./configs/compose.env -f docker-compose.yml up --build -d
```

The stack publishes only the web container on `WEB_PORT`. With the example values, the browser calls:

- `/api/*` -> internal `api:8000`
- `VITE_ESPLORA_BASE_URL` -> the public Esplora/explorer origin

The same-origin `/api` shape avoids browser CORS issues for normal deployment. `web-v2`
reads its public settings from Vite at image build time, so rebuild the web image after
changing any `VITE_*` value.

## Required Configuration

Set these values in `deployment/configs/compose.env`:

- `PUBLIC_ORIGIN`: the final public HTTPS origin, for example `https://lending.example.com`
- `WEB_PORT`: host port mapped to the public web server
- `VITE_API_URL`: public indexer API URL baked into `web-v2`, for example `https://lending.example.com/api`
- `VITE_ESPLORA_BASE_URL`: public Esplora/explorer base URL, for example `https://blockstream.info/liquidtestnet`
- `VITE_NETWORK`: `liquid`, `liquidtestnet`, or `regtest`
- `VITE_WATERFALLS_URL`: Waterfalls server base URL for LWK sync
- `VITE_WATERFALLS_RECIPIENT`: Waterfalls server recipient
- `VITE_DEBUG_MNEMONIC`: optional development/testnet software signer mnemonic; leave unset in normal deployments
- `INDEXER_ESPLORA_BASE_URL`: the Esplora API used by the backend indexer
- `WEB_ESPLORA_API_UPSTREAM`: the Esplora API proxied by nginx, for example `https://blockstream.info/liquidtestnet/api`
- `INDEXER_POLL_INTERVAL_MS`: background polling interval
- `INDEXER_LAST_INDEXED_HEIGHT`: first height to index from
- `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`: database connection settings

## GitLab Image Builds

The GitLab `build_web` job passes the `VITE_*` variables above as Docker build args. It
fails early when `VITE_API_URL`, `VITE_ESPLORA_BASE_URL`, `VITE_NETWORK`, or
`VITE_WATERFALLS_URL` is missing. Configure those variables in the mirrored GitLab
project before running the web image job.

On the default branch, `build_backend` and `build_web` run automatically. On feature
branches they remain manual so a mirrored PR branch can be tested without deploying
every pushed commit.

## CORS, Proxying, and Other Deployment Pitfalls

- The default deployment keeps the API private and exposes it through nginx as `/api`. In that shape, browser CORS is mostly avoided.
- The current backend does not enable cross-origin browser access. Keep the browser on the same public origin as `/api`, or add backend CORS support before exposing the API on a separate origin.
- The frontend also makes browser-side Esplora calls through `VITE_ESPLORA_BASE_URL`.
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
- `http://localhost:${WEB_PORT}/api/health`
- `http://localhost:${WEB_PORT}/api/offers?limit=1`
