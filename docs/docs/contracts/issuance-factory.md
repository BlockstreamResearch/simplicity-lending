---
description: The borrower's account. It issues the assets an offer needs, and it can be removed.
---

# Issuance factory

The issuance factory is the borrower's account. It is the output that issues the assets later offers depend on, and it will only do that in a transaction that also spends the account's authorization token.

## Where it is spent

[Creating an account](../borrower/create-account.md) produces this output and the token that authorizes it. [Publishing an offer](../borrower/create-offer.md) spends both: the factory output is recreated, the token is handed back, and the new assets, including the borrower NFT and the lender NFT, are issued. A second path destroys the factory and burns the token. That removes the account.

## Parameters

These values are fixed when the output is created. Changing either of them produces a different address.

| Parameter | Type | What it fixes |
| --- | --- | --- |
| `ISSUING_UTXOS_COUNT` | `u8` | How many assets this output issues in one transaction. |
| `REISSUANCE_FLAGS` | `u64` | One bit per issued asset. A set bit requires a non-zero reissuance token. A clear bit requires a reissuance amount of zero. |

## Spending paths

| Path | Witness | What it checks |
| --- | --- | --- |
| [Issue](../borrower/create-offer.md) | `output_index: u32` | The authorization token and the factory output each move through at amount 1, on the same asset, and the factory output keeps its script. Each of the `ISSUING_UTXOS_COUNT` issuances appears as an explicit output of the same amount. The reissuance amount follows the bit of `REISSUANCE_FLAGS` for that asset. |
| Remove | `output_index: u32` | The factory output and the authorization token are burned. No new assets are issued. |

## Source

- [`crates/contracts/simf/issuance_factory.simf`](https://github.com/BlockstreamResearch/simplicity-lending/blob/main/crates/contracts/simf/issuance_factory.simf)
- [`crates/contracts/src/programs/issuance_factory/params.rs`](https://github.com/BlockstreamResearch/simplicity-lending/blob/main/crates/contracts/src/programs/issuance_factory/params.rs)
- [`crates/contracts/src/programs/issuance_factory/witness.rs`](https://github.com/BlockstreamResearch/simplicity-lending/blob/main/crates/contracts/src/programs/issuance_factory/witness.rs)
