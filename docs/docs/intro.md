# Introduction

Simplicity Lending is a peer-to-peer lending protocol implemented in SimplicityHL.

A borrower publishes an offer that pledges collateral and states the principal they want, how long the loan lasts, and the interest they will pay. A lender who accepts the offer provides that principal. Before expiry the borrower can repay and take the collateral back. If the loan is not repaid in time, the lender can liquidate the position and claim the collateral.

The borrower can cancel an offer before a lender accepts it.

## Documentation map

- [Concepts](./concepts/participants.md) — who takes part, which terms an offer carries, and how a position changes state
- [Lifecycle](./lifecycle/create-offer.md) — create, cancel, accept, repay, and liquidate
- [Components](./components/contracts.md) — contracts, CLI, indexer, and the demo web app
- [Guides](./guides/docker.md) — run the stack with Docker or locally
