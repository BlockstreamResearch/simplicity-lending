# Simplicity Lending — Web UI

Frontend for the Simplicity Lending protocol. Uses the indexer REST API.

## Setup

```bash
npm install
```

Optional: copy `.env.example` to `.env` and set `VITE_API_URL` if the API is not on `http://localhost:8000`. The Dashboard "MOST RECENT 10 SUPPLY OFFERS" list is loaded from the Lending Indexer via `GET /offers`; the indexer must be running in API mode (default or `RUN_MODE=api`) and the frontend uses `VITE_API_URL` to reach it.

## Run

Start the indexer API (from repo root):

```bash
cargo run -p lending-indexer
```

Then start the dev server:

```bash
npm run dev
```

Open the URL shown in the terminal (e.g. http://localhost:5173). The offers list is loaded from `GET /offers`.

## Build

```bash
npm run build
```

Output is in `dist/`.
