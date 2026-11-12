# Dockerized Simplicity Lending Deployment

This deployment stack runs:

- `postgres` for indexed state
- `migrate` to apply the SQLx schema before the app starts
- `api` for the lending protocol HTTP API
- `indexer` for background chain indexing
- `web` for the public frontend, including `/api` and `/esplora` reverse proxies

## Layout

Most deployment knobs live in `deployment/configs`:

- `compose.env.example`: the single env file template for compose, image build args, and runtime configuration
- `nginx/default.conf.template`: reverse proxy and SPA serving rules

The backend image ships `crates/indexer/configuration/base.yaml` with public defaults. Secrets and
per-deployment values are passed only through the environment: `DATABASE_URL` plus
`INDEXER_<SECTION>__<KEY>` overrides of any `base.yaml` key (for example
`INDEXER_ESPLORA__BASE_URL`). The same image therefore runs in every environment without
rebuilding or rendering config files.

## Quick Start

From `deployment/`:

```bash
git submodule update --init ../lwk
cp ./configs/compose.env.example ./configs/compose.env
docker compose --env-file ./configs/compose.env -f docker-compose.yml up --build -d
```

The stack publishes only the web container on `WEB_PORT`. With the example values, the browser calls:

- `/api/*` -> internal `api:8000`
- `VITE_ESPLORA_BASE_URL` -> the public Esplora/explorer origin

The same-origin `/api` shape avoids browser CORS issues for normal deployment. `web`
reads its public settings from Vite at image build time, so rebuild the web image after
changing any `VITE_*` value.

## Required Configuration

Set these values in `deployment/configs/compose.env`:

- `WEB_PORT`: host port mapped to the public web server
- `VITE_API_URL`: indexer API URL baked into `web`, for example `/api` for the same-origin nginx proxy or `https://lending.example.com/api`
- `VITE_ESPLORA_BASE_URL`: public Esplora/explorer base URL, for example `https://blockstream.info/liquidtestnet`
- `VITE_NETWORK`: `liquid`, `liquidtestnet`, or `regtest`
- `VITE_WATERFALLS_URL`: Waterfalls server base URL for LWK sync
- `VITE_WATERFALLS_RECIPIENT`: Waterfalls server recipient
- `VITE_DEBUG_MNEMONIC`: optional development/testnet software signer mnemonic; leave unset in normal deployments
- `VITE_SIDESWAP_WS_URL`: optional experimental SideSwap wallet connect server URL; leave unset to disable that connect option
- `WEB_ESPLORA_API_UPSTREAM`: the Esplora API proxied by nginx, for example `https://blockstream.info/liquidtestnet/api`
- `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`: credentials of the bundled `postgres` service
- `DATABASE_URL`: connection string used by `api`, `indexer` and `migrate`; with the bundled database it is `postgres://<user>:<password>@postgres:5432/<db>`

Optional indexer overrides of `base.yaml`:

- `INDEXER_ESPLORA__BASE_URL`: the Esplora API used by the backend indexer
- `INDEXER_ESPLORA__NETWORK`: `liquid`, `liquidtestnet`, or `regtest`
- `INDEXER_INDEXER__INTERVAL`: background polling interval in milliseconds
- `INDEXER_INDEXER__PROTOCOL_FEE_KEEPER_ASSET_ID`: protocol-fee keeper asset tracked by the indexer
- `INDEXER_INDEXER__LAST_INDEXED_HEIGHT`: first height to index from on an empty database
- `INDEXER_INDEXER__ASSET_REGISTRY__DOMAIN`: ELIP-0100 issuer domain (the public host, e.g. `lending.example.com`); asset registration is disabled while unset
- `INDEXER_INDEXER__ASSET_REGISTRY__REGISTRY_URL`: asset registry to submit to; an empty value skips submission

## GitLab Image Builds

The GitLab `build_web` job passes the `VITE_*` variables above as Docker build args. It
defaults to Liquid testnet values and `/api` for the same-origin nginx API proxy, while
allowing GitLab project variables with the same names to override those defaults. It
still fails early when any required value is empty after defaults are applied.

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
- `http://localhost:${WEB_PORT}/api/ready`
- `http://localhost:${WEB_PORT}/api/offers?limit=1`
