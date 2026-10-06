---
description: The offer itself. Collateral stays in this output until the offer is cancelled, repaid in full, or liquidated.
---

# Lending

The lending program is the offer. Collateral sits in its output from the moment the offer is published until the offer is cancelled, repaid in full, or liquidated.

## Where it is spent

Every row of [Actions](../protocol/actions.md) except claiming the principal and claiming the repayment spends this output: [publishing](../borrower/create-offer.md), [cancelling](../borrower/cancel-offer.md), [funding](../lender/fund-offer.md), [repaying](../borrower/repay.md), and [liquidating](../lender/liquidate.md).

## Parameters

These values are fixed when the offer output is created. Changing any of them produces a different address. The collateral, principal, rate, and deadline are the terms described in [Offer parameters](../protocol/offer-parameters.md). The remaining values connect this output to the other contracts.

| Parameter | Type | What it fixes |
| --- | --- | --- |
| `COLLATERAL_ASSET_ID` | `u256` | Asset locked as collateral. |
| `COLLATERAL_AMOUNT` | `u64` | Amount of that asset locked in the offer. |
| `PRINCIPAL_ASSET_ID` | `u256` | Asset the lender pays and the borrower repays. |
| `PRINCIPAL_AMOUNT` | `u64` | Amount of that asset the lender pays. |
| `PRINCIPAL_INTEREST_RATE` | `u64` | Fee rate in basis points. |
| `LOAN_EXPIRATION_TIME` | `u32` | Deadline as a Liquid block height. |
| `BORROWER_NFT_ASSET_ID` | `u256` | Token that authorizes the borrower. |
| `LENDER_NFT_ASSET_ID` | `u256` | Token that authorizes the lender. |
| `LENDER_VAULT_COV_HASH` | `u256` | Active script of the lender's repayment vault. |
| `FINALIZED_LENDER_VAULT_COV_HASH` | `u256` | Script of that vault once the debt is paid. |
| `PROTOCOL_FEE_VAULT_COV_HASH` | `u256` | Active script of the protocol fee vault. |
| `FINALIZED_PROTOCOL_FEE_VAULT_COV_HASH` | `u256` | Script of that vault once the protocol fee is paid. |
| `PRINCIPAL_OUTPUT_SCRIPT_HASH` | `u256` | Script of the output that receives the principal. |

## Spending paths

The remaining debt is not one of those parameters. A repayment or a liquidation names it as `current_debt`, and the contract accepts the spend only when this input's script hash is the hash stored for that debt.

| Path | Witness | What it checks |
| --- | --- | --- |
| [Funding](../lender/fund-offer.md) | none | The collateral returns at the same amount on an output marked active. The lender NFT is presented and returned at amount 1. The principal is paid, for `PRINCIPAL_AMOUNT`, to `PRINCIPAL_OUTPUT_SCRIPT_HASH`. Any block height is accepted. |
| [Cancelling](../borrower/cancel-offer.md) | none | The input is still the pending offer and holds the original collateral. The borrower NFT and the lender NFT are burned. The collateral may leave the contract. |
| Partial repayment | `current_debt: u64`, `amount_to_repay: u64` | The payment is greater than zero and less than `current_debt`. A share of the collateral, in proportion to the payment against the total amount owed, leaves the output, and the rest stays. The borrower NFT is returned. The fee is taken before the principal, and the protocol fee share and the lender's share must each land on an [asset auth vault](./asset-auth-vault.md). |
| [Full repayment](../borrower/repay.md) | `current_debt: u64` | The collateral input still accounts for the original collateral. The borrower NFT is burned, and the remaining debt is paid into the vaults. This path finalizes the lender's vault. The protocol fee vault is finalized once its share of the fee has been paid. |
| [Liquidation](../lender/liquidate.md) | `current_debt: u64` | The transaction's block height has reached `LOAN_EXPIRATION_TIME`. This is the only path that reads the deadline. The collateral input still accounts for what has not been repaid, the lender NFT is burned, and the collateral may leave the contract. |

These paths read assets, amounts, scripts, and, for liquidation, the block height.

## Source

- [`crates/contracts/simf/lending.simf`](https://github.com/BlockstreamResearch/simplicity-lending/blob/main/crates/contracts/simf/lending.simf)
- [`crates/contracts/src/programs/lending/params.rs`](https://github.com/BlockstreamResearch/simplicity-lending/blob/main/crates/contracts/src/programs/lending/params.rs)
- [`crates/contracts/src/programs/lending/witness.rs`](https://github.com/BlockstreamResearch/simplicity-lending/blob/main/crates/contracts/src/programs/lending/witness.rs)
