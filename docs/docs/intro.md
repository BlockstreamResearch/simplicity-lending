# Introduction

Simplicity Lending is a peer-to-peer lending protocol implemented in SimplicityHL.

A borrower publishes an offer that pledges collateral and states the principal they want, how long the loan lasts, and the interest they will pay. A lender who accepts the offer provides that principal. Before expiry the borrower can repay and take the collateral back. If the loan is not repaid in time, the lender can liquidate the position and claim the collateral.

The borrower can cancel an offer before a lender accepts it.

## Documentation map

- [Simplicity](./simplicity.md) — the language the contracts are written in
- [Roles](./roles.md) — what borrowers and lenders can do
- [Offer parameters](./offer-parameters.md) — collateral, loan amount, fee, and term
- [Borrower](./borrower/create-account.md) and [Lender](./lender/review-offer.md) — the steps each role takes
- [Contracts](./contracts/lending.md) — reference for the Simplicity programs
- [Developers](./developers/versions.md) — versions, build, and how to run the stack
