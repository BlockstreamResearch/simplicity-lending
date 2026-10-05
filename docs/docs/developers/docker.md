---
description: The two compose stacks — the indexer and API from the repository root, and the full stack under deployment/.
---

# Run with Docker

There are two compose files. The one at the repository root runs the indexer and the API. The one under `deployment/` also builds and serves the web app, and it generates the contract artifacts inside the image.

## Indexer and API

From the repository root, copy the environment file and start the stack:

```bash
cp .env.example .env
docker compose up --build
```

Generate the contract artifacts on the host before that build, as [Build](./build.md) describes. The indexer image compiles the workspace from the files in the build context, and `crates/contracts/src/artifacts` is part of that context.

The stack runs five services:

- **postgres**, Postgres 16, with the user, password, and database from `.env`.
- **migrate**, which applies the SQLx migrations and then exits.
- **api**, the indexer binary with `RUN_MODE=api`.
- **indexer**, the same binary with `RUN_MODE=indexer`, polling Liquid testnet.
- **nginx**, which publishes `${API_PORT:-8000}` on the host and proxies it to the API.

The example file sets `API_PORT` to 8000, so the API is at `http://localhost:8000`. Paths are the API's own paths, such as `http://localhost:8000/offers` and `http://localhost:8000/swagger-ui/`. The web app is started separately and pointed at that URL, as [Run locally](./local-setup.md) describes.

`DATABASE_URL` in the example file uses the host name `postgres`, which is the Compose service. That value is for the containers. A database URL used from the host, for sqlx on your machine, uses `localhost` instead.

## Full stack

The deployment stack adds the web app. The backend image installs Simplex at the pinned commit and runs `simplex build` before it compiles, so a fresh checkout can build this image on its own.

From `deployment/`:

```bash
cp ./configs/compose.env.example ./configs/compose.env
docker compose --env-file ./configs/compose.env -f docker-compose.yml up --build -d
```

The web container is the only one published on the host, on `WEB_PORT`. The browser calls the API at `/api` on that same origin. `VITE_*` values are baked in when the web image is built, so a change to them means rebuilding that image.

The template and the meaning of each variable are in [`deployment/README.md`](https://github.com/BlockstreamResearch/simplicity-lending/blob/main/deployment/README.md).
