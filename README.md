# Simplicity lending protocol

A pure SimplicityHL implementation of a peer-to-peer lending protocol.

## High-level mechanics

Borrowers create "borrowing offers" with specified _collateral amount_, _lending duration_, and _principal asset amount_ (interest) they are willing to pay for the credit settlement. They also specify the _amount of principal_ they are willing to receive for the pledged collateral.

The Borrower can cancel the initial offer before it is accepted.

If a Lender is satisfied with such conditions, they provide principal to the borrower, creating a lending contract.

At any point in time before the lending contract expiry, the Borrower can repay the principal amount with interest and take their collateral back.

In case the Borrower fails to pay interest before the lending contract expiry, the Lender can liquidate the position and claim collateral for themselves.

## Repository structure

- **crates/** — Rust workspace with three components:
  - **CLI** — command-line tools for the lending protocol (building and signing transactions).
  - **Contracts** — Simplicity contracts and covenant logic for the lending protocol.
  - **Indexer** — backend service that indexes offers and exposes an API for the web app.
- **web/** — demo frontend (React/TypeScript) for borrowers and lenders.

## How to use

To run the **demo frontend** (web app for borrowers and lenders), you need the **Indexer** API running. The web app talks to it to list and manage offers.

**Quick start (from repo root):**

1. **Indexer** — set up PostgreSQL, configure `crates/indexer` (see [crates/indexer/README.md](crates/indexer/README.md)), then:
   ```bash
   cd creates/indexer && cargo run -p lending-indexer
   ```
   By default this starts the API (port 8000). For full indexing you also need the indexer worker (`RUN_MODE=indexer`).

2. **Web** — install deps and start the dev server (see [web/README.md](web/README.md)):
   ```bash
   cd web && npm install && npm run dev
   ```
   Open the URL shown (e.g. http://localhost:5173). Set `VITE_API_URL` in `web/.env` if the API is not at `http://localhost:8000`.

**CLI** and **Contracts** are used for building/signing lending transactions and covenant logic; see the respective crates under `crates/` for development and usage.
