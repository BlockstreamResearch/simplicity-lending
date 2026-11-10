---
description: Withdraw the lender's share of the repayment from the asset auth vault.
---

# Claim repayment

The lender's share of the [repayment](../borrower/repay.md) sits in a finalized [asset auth vault](../contracts/asset-auth-vault.md): the lender's part of the fee and the principal. The protocol fee stays in its own vault.

The claim spends that vault and the lender NFT. The NFT is burned, and the balance is paid to the lender. The app offers this once the offer is [repaid](../protocol/actions.md). tL-BTC inputs from the wallet pay the network fee, and the remainder comes back.

<TxDiagram>

![Full repayment claim](../schemas/lender/final-claim.svg)

</TxDiagram>
