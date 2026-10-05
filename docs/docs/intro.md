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
3. **The borrower repays.** At any point before the deadline the borrower repays the principal plus the fee, in one go or in parts, and the collateral is released back to them.
4. **Or the term expires.** If the debt has not been cleared by the deadline, the lender can liquidate the position and claim the collateral.

Once a loan is active, repayment and liquidation are the only two ways it can end, and the contract decides between them.

## What a loan costs

Interest does not accrue over time. An offer carries a single interest rate, fixed when the offer is created, and the amount the borrower owes on top of the principal is `principal × rate ÷ 10000`.

The rate is stored in basis points, which are hundredths of a percent. Dividing by 10000 is what turns them back into a plain fraction, because 10000 basis points make up 100%. A rate of 500 is therefore 5%: a loan of 1000 TEST at that rate carries a fee of 50 TEST, and the borrower repays 1050 TEST in total.

The app lets a borrower enter the fee as an amount and converts it to a rate before the offer is published, so the value stored in the contract is always the rate. The same fee is owed whether the loan is repaid on its first day or its last. The app also displays an APR, which annualizes that fee against the term so offers of different lengths can be compared; it is not a rate the contract charges.

Repayment can be made in parts, and the fee is cleared before the principal.

:::info[The lender does not receive the whole fee]

A protocol fee of 10% is taken out of the fee as it is paid. On a fee of 50 TEST, 5 TEST goes to the protocol and 45 TEST to the lender. The borrower still owes the full 50 TEST, so the deduction changes what the lender earns rather than what the loan costs. The APR shown in the app is calculated from the whole fee, which means a lender's actual return is roughly a tenth lower than the figure on screen.

:::

## Liquidation follows the term, not the price

Most lending protocols liquidate a position when the value of its collateral falls below a threshold. This one does not. The contract has no price feed — the only thing it checks is whether the deadline block height has been reached.

This has consequences worth understanding before you use the protocol:

- A borrower cannot be liquidated by market volatility during the term. The deadline is the only thing that matters.
- A lender carries the price risk of the collateral for the whole term and is compensated for it by the fee agreed in the offer.
- The app rejects offers above 55% loan-to-value when the offer is created. That is a check in the interface, not a rule in the contract, and it is not re-evaluated afterwards.

:::warning[Repay before the deadline, not on it]

There is no grace period. Liquidation becomes available the moment the deadline block is reached. The contract does not block repayment after that point either, so once the deadline passes both transactions are valid at the same time and the position goes to whichever one confirms first — a late borrower is relying on the lender not having broadcast yet.

A term is also measured in blocks, not in days. The app converts the term you pick into a block count assuming roughly one Liquid block per minute, so the "7 days" or "30 days" you selected is an estimate; what the contract enforces is the block height. Leave margin instead of planning to repay on the final day.

:::

## What you hold

The protocol is self-custodial. Collateral never moves to a counterparty or to the protocol itself: it sits in a contract output that only a transaction satisfying the contract can spend.

Your side of a loan is a token in your own wallet. Creating an offer issues two assets of exactly one unit each — a borrower NFT and a lender NFT — and each lives in an ordinary Liquid output. There are no accounts, logins, or registered addresses: possessing that output is what makes you the borrower or the lender.

The contract enforces this directly. Each action it permits requires the matching token to appear in the transaction at a particular input, with the exact asset ID and an amount of one:

- **Repaying in part** requires the borrower NFT. It is spent and handed straight back, so the borrower keeps it for the next payment.
- **Repaying in full** requires the borrower NFT and burns it, which closes the position.
- **Liquidating** after the deadline requires the lender NFT and burns it.
- **Cancelling** an offer before it is funded requires both tokens and burns both. Until a lender appears, the lender NFT is not in anyone's wallet — it waits in a contract output tied to the offer, which is why the borrower can cancel alone.

A transaction that does not carry the right token in the right position is simply invalid, so the token *is* the authorization. One consequence is worth noting: a position follows the token rather than a person. Whoever controls that output can act in the role, and handing it to someone else hands over the role with it.

Before publishing a first offer, a borrower also creates an account, which is itself an authorization token plus a contract that issues the role NFTs for each later offer. [Create an account](./borrower/create-account.md) covers that step.

An indexer service watches the chain and lists open offers so that the app can display them. It only reads: it cannot move funds, and every change to a position still requires a transaction signed by you.

## At a glance

| Parameter | Value |
| --- | --- |
| Network | Liquid testnet |
| Collateral | [tL-BTC](https://blockstream.info/liquidtestnet/asset/144c654344aa716d6f3abcc1ca90e5641e4e2a7f633bc09fe3baf64585819a49) |
| Principal | [TEST](https://blockstream.info/liquidtestnet/asset/38fca2d939696061a8f76d4e6b5eecd54e3b4221c846f24a6b279e79952850a5) |
| Term | A fixed number of blocks, chosen when the offer is created (7 to 90 days in the app) |
| Fee | An interest rate in basis points, fixed for the whole term |
| Protocol fee | 10% of the fee, deducted before the lender is paid |
| Liquidation trigger | Term expiry only |
| Custody | Self-custodial — collateral is held by the contract |

## Documentation map

- [Simplicity](./simplicity.md) — the language the contracts are written in
- [Roles](./roles.md) — what borrowers and lenders can do
- [Offer parameters](./offer-parameters.md) — collateral, loan amount, fee, and term
- [Borrower](./borrower/create-account.md) and [Lender](./lender/review-offer.md) — the steps each role takes
- [Contracts](./contracts/lending.md) — reference for the Simplicity programs
- [Developers](./developers/versions.md) — versions, build, and how to run the stack
