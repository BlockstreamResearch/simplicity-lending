---
description: Pay back the principal and the fee, and release the collateral locked in the offer.
---

# Repay

Once the loan is active and the principal has been [claimed](./claim-principal.md), the borrower pays the whole debt in one transaction: the principal and the fee together. The fee is settled before the principal. Ten percent of the fee goes to the protocol fee vault, and the rest of the payment, including the principal, goes to the lender's vault. Both vaults are created finalized. [Offer parameters](../protocol/offer-parameters.md) defines the fee, and [asset auth vault](../contracts/asset-auth-vault.md) is the output that holds each share.

The transaction spends the borrower NFT and the active [lending](../contracts/lending.md) output, plus enough of the principal asset to cover the debt. The borrower NFT is burned. The collateral is paid back to the borrower. Any principal above the debt, and the tL-BTC used for the network fee, comes back to the wallet. [Actions](../protocol/actions.md) explains why this burn means the principal has to be claimed first.

<TxDiagram>

![Full repayment transaction](../schemas/borrower/final-repay.svg)

</TxDiagram>

After the deadline block, repayment and liquidation are both valid, as [Actions](../protocol/actions.md) describes.
