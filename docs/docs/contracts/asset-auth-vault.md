---
description: Holds a repayment until the authorized party withdraws it, and accepts further payments while it is active.
---

# Asset auth vault

An asset auth vault holds one asset and lets an authorized party add to it or take from it. While the vault is active, funds can be added and a part can be withdrawn. Once it is finalized, the only remaining action is to withdraw everything.

## Where it is spent

A repayment creates or extends two vaults, both holding the principal asset. One receives the lender's share of the fee and then the principal. The other receives the protocol fee. [Lending](./lending.md) requires those outputs on every repayment. The lender later spends their vault in [Claim the repayment](../lender/claim-repayment.md). The protocol fee vault is spent the same way by whoever holds its keeper asset.

The lender's vault is authorized by the lender NFT, and taking the whole balance burns that token. The protocol fee vault is authorized by a separate keeper asset, which is not burned. Adding funds is authorized by the borrower NFT.

## Parameters

These values are fixed when the output is created. Changing any of them produces a different address. The active vault and the finalized vault are the same program. The finalized one is built with `IS_ACTIVE` clear.

| Parameter | Type | What it fixes |
| --- | --- | --- |
| `VAULT_ASSET_ID` | `u256` | Asset the vault holds. |
| `KEEPER_AUTH_ASSET_ID` | `u256` | Asset that authorizes a withdrawal. |
| `KEEPER_AUTH_ASSET_AMOUNT` | `u64` | Minimum amount of the keeper asset that must be presented. |
| `WITH_KEEPER_ASSET_BURN` | `bool` | A full withdrawal burns the keeper asset. |
| `SUPPLIER_AUTH_ASSET_ID` | `u256` | Asset that authorizes adding funds. |
| `WITH_SUPPLIER_ASSET_BURN` | `bool` | The last supply burns the supplier asset. |
| `FINALIZED_VAULT_COV_HASH` | `u256` | Script the vault moves to on the last supply. |
| `IS_ACTIVE` | `bool` | Set while funds can still be added. Clear once the vault is finalized. |

## Spending paths

| Path | Witness | What it checks |
| --- | --- | --- |
| Supply | `input_supplier_index: u32`, `output_supplier_index: u32`, `vault_output_index: u32`, `amount_to_supply: u64` | The vault is active. At least one unit of the supplier asset is presented and returned. The output holds the previous balance plus `amount_to_supply`, under the same script. |
| [Final supply](../borrower/repay.md) | `input_supplier_index: u32`, `output_supplier_index: u32`, `vault_output_index: u32`, `amount_to_supply: u64` | The vault is active. The output script is `FINALIZED_VAULT_COV_HASH`, and the balance grows by `amount_to_supply`. The supplier asset is burned when `WITH_SUPPLIER_ASSET_BURN` is set. |
| Withdraw part | `input_keeper_index: u32`, `output_keeper_index: u32`, `vault_output_index: u32`, `amount_to_withdraw: u64` | The vault is active, and `amount_to_withdraw` is strictly less than the balance. The remainder stays under the same script. The keeper asset is presented and returned. |
| [Withdraw all](../lender/claim-repayment.md) | `input_keeper_index: u32`, `output_keeper_index: u32` | The vault is finalized. The keeper asset is presented for at least `KEEPER_AUTH_ASSET_AMOUNT`, and it is burned when `WITH_KEEPER_ASSET_BURN` is set. |

## Source

- [`crates/contracts/simf/asset_auth_vault.simf`](https://github.com/BlockstreamResearch/simplicity-lending/blob/main/crates/contracts/simf/asset_auth_vault.simf)
- [`crates/contracts/src/programs/asset_auth_vault/params.rs`](https://github.com/BlockstreamResearch/simplicity-lending/blob/main/crates/contracts/src/programs/asset_auth_vault/params.rs)
- [`crates/contracts/src/programs/asset_auth_vault/witness.rs`](https://github.com/BlockstreamResearch/simplicity-lending/blob/main/crates/contracts/src/programs/asset_auth_vault/witness.rs)
