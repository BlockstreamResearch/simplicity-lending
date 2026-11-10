---
description: How Simplicity contracts run on Liquid, and what you need to know to read the rest of this documentation.
---

# Simplicity

The lending contracts are written in [SimplicityHL](https://docs.simplicity-lang.org/simplicityhl-reference/), a language with Rust-like syntax, and compile to [Simplicity](https://docs.simplicity-lang.org/), which is what a Liquid node actually executes. Simplicity is a smart contract language for Bitcoin-like blockchains. A program is a check over a transaction: it either authorizes the spend or the transaction is invalid, and the resources that check will use are known before the transaction is funded.

Simplicity has been live on Liquid mainnet since July 2025. The lending protocol documented here is a demo on Liquid testnet, which the [introduction](./intro.md) covers.

The [language documentation](https://docs.simplicity-lang.org/) is where syntax, jets, and program structure are explained. This page only covers the parts you need in order to follow the rest of this site.

## A contract runs when an output is spent

On Liquid, a Simplicity contract is the spending condition of a single output. It does not keep running in the background. It executes at the moment a transaction tries to spend that output, it sees that transaction as a whole, and it either accepts the spend or the transaction is rejected.

The wallet is what builds the transaction. The contract only checks it. This is what it means, in the introduction, that the contract decides how a loan ends. Repayment and liquidation are two different transactions a wallet can propose, and once the deadline block is reached both of them satisfy the contract. The position goes to whichever transaction confirms first.

## Terms are part of the address

A SimplicityHL program takes two kinds of input, and the difference between them is why an offer's terms cannot change after it is published.

**Parameters**, written `param::`, are fixed when the contract is created and become part of the resulting address. For a lending offer they include the collateral amount, the principal, the interest rate, the deadline as a block height, and the asset IDs involved. Changing any of them produces a different address, so publishing an offer with different terms means publishing a different contract.

**Witness data**, written `witness::`, is provided at the moment the output is spent. In the lending contract it chooses which action the transaction is attempting — funding the offer, cancelling it, repaying part of the debt, repaying all of it, or liquidating — and it carries the figures that action needs, such as the debt still outstanding.

## What a contract can see

A contract does not look up an account balance or a price. It inspects the transaction in front of it: the asset and the amount on each input and output, the script guarding an output, and the block height the transaction is valid at. Everything this documentation describes a contract as "checking" is one of those inspections. Requiring the borrower NFT on a given input means comparing that input's asset and amount with the values stored in the contract. A deadline means comparing the transaction's block height with the height stored as a parameter.

## Several contracts in one transaction

The protocol is five contracts rather than one, and each is the spending condition of its own output. A lending transaction spends several of those outputs at once, and each contract checks only the input it guards.

[Lending](./contracts/lending.md) is the offer. The [issuance factory](./contracts/issuance-factory.md) creates the role tokens for an account. [Script auth](./contracts/script-auth.md) holds a token until one specific contract spends it. [Asset auth](./contracts/asset-auth.md) and the [asset auth vault](./contracts/asset-auth-vault.md) control where a particular asset is allowed to move. The [Contracts](./contracts/lending.md) section describes each of them.

:::warning[Send explicit amounts only]

Liquid can hide the asset and the amount of an output. These contracts read both in the open, and a confidential value fails the check. An output like that, paid to one of these contracts, can never be spent, so the funds in it stay where they are. Only send these contracts outputs whose asset and amount are visible.

:::

The contracts in this repository are built and tested with [Simplex](https://docs.simplicity-lang.org/documentation/simplex/), the Rust framework for SimplicityHL. It turns the contract source into the Rust code that assembles witnesses and transactions, and it runs the contract tests against a local Liquid node. Setting that up is covered under [Developers](./developers/build.md).
