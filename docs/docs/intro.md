---
description: A peer-to-peer lending protocol on the Liquid Network, where loan terms are fixed when the offer is created and enforced on-chain by a Simplicity contract.
---

# Introduction

Simplicity Lending is a peer-to-peer lending protocol on the Liquid Network. A borrower locks bitcoin as collateral and receives a loan in another asset directly from another user. There is no lending pool and no intermediary holding the money: every loan is an agreement between two parties, and its terms are fixed when the offer is created and enforced on-chain by a Simplicity contract.

:::info[Status]

The protocol is a demo running on Liquid testnet. It is being actively tested and improved, and the assets it uses have no real value. Treat it as software to experiment with rather than a place to put funds you care about.

:::

## How a loan works

1. **A borrower publishes an offer.** They lock collateral in a contract and state how much principal they want, the fee they will pay for it, and how long the loan lasts. Until someone funds the offer, the borrower can cancel it and take the collateral back.
2. **A lender funds the offer.** The lender provides the principal to the borrower. The loan is now active and its deadline is fixed.
3. **The borrower repays.** The borrower repays the principal plus the fee, in one go or in parts, and the collateral is released back to them.
4. **Or the term expires.** If the debt has not been cleared by the deadline, the lender can liquidate the position and claim the collateral.

The fee is a single rate, fixed for the whole term, and the lender receives 90% of it. How that rate is stored, and what the protocol keeps, is in [Offer parameters](./protocol/offer-parameters.md).

Collateral never moves to the counterparty or to the protocol. It sits in a contract output, and a role token in your own wallet is what lets you act on the loan. [Roles](./protocol/roles.md) explains that token. [Actions](./protocol/actions.md) lists what it authorizes.

An indexer watches the chain and lists open offers for the app. It only reads: it cannot move funds, and every change still requires a transaction signed by you.

## Liquidation follows the term, not the price

The contract has no price feed. A fall in the collateral's price during the term does not liquidate the loan. The deadline does. The app's loan-to-value check, and how the deadline is measured, are in [Offer parameters](./protocol/offer-parameters.md). What becomes possible once that deadline is reached is in [Actions](./protocol/actions.md).

## Documentation map

- [Simplicity](./simplicity.md) — the language the contracts are written in
- [Roles](./protocol/roles.md) — the token that makes someone a borrower or a lender
- [Actions](./protocol/actions.md) — what each role can do, and when
- [Offer parameters](./protocol/offer-parameters.md) — collateral, loan amount, fee, and term
- [Borrower](./borrower/create-account.md) and [Lender](./lender/review-offer.md) — the steps each role takes
- [Contracts](./contracts/lending.md) — reference for the Simplicity programs
- [Developers](./developers/versions.md) — versions, build, and how to run the stack
