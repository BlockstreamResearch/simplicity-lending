# Local setup

The demo frontend needs the indexer API.

1. Configure and start the indexer. See `crates/indexer/README.md`.
2. Install dependencies and start the web app. See `web/README.md`.

The web app expects the API at `http://localhost:8000` unless `VITE_API_URL` is set.
