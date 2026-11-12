---
description: The states an offer moves through, and which action is open in each one.
---

# Actions

An offer moves through a small set of states. The state decides which action is open. How to carry an action out, including the transaction behind it, is written up under [Borrower](../borrower/create-account.md) and [Lender](../lender/review-offer.md). Reading an offer before funding it moves no funds; that step is [Review an offer](../lender/review-offer.md).

## States

- **Pending.** The collateral is locked and nobody has funded the offer. The borrower can cancel it. A lender can fund it, and the contract allows that even after the deadline.
- **Active.** A lender has funded the offer. The borrower claims the principal and repays. Once the deadline block is reached, the lender can liquidate.
- **Repaid.** The borrower has repaid in full and has the collateral back. The lender can claim that repayment.
- **Liquidated.** The lender has taken the collateral. The borrower can still claim the principal if they never did.
- **Cancelled.** The borrower took the collateral back before anyone funded the offer.
- **Claimed.** The lender has taken the repayment. Nothing is left to do.

## What is open, and when

| Action | Role | When | Authorization |
| --- | --- | --- | --- |
| [Publish an offer](../borrower/create-offer.md) | Borrower | The borrower has an account | The account mints the two role tokens. The borrower NFT goes to the borrower's wallet. The lender NFT waits in a contract output tied to the offer |
| [Cancel the offer](../borrower/cancel-offer.md) | Borrower | Pending, whether or not the deadline has passed | Both role tokens. The lender NFT is still in the contract output, so the borrower can cancel without a lender |
| [Fund the offer](../lender/fund-offer.md) | Lender | Pending, including after the deadline | The lender NFT moves out of the contract output and into the lender's wallet |
| [Claim the principal](../borrower/claim-principal.md) | Borrower | Active, and again after liquidation if it was never claimed | The principal output created when the offer was funded |
| [Repay](../borrower/repay.md) | Borrower | Active. The app offers it once the principal has been claimed | The borrower NFT, which the transaction burns. The collateral is released |
| [Liquidate](../lender/liquidate.md) | Lender | Active, once the deadline block has been reached | The lender NFT, which the transaction burns. The collateral goes to the lender |
| [Claim the repayment](../lender/claim-repayment.md) | Lender | Repaid | The repayment held for the lender |

:::warning[An expired offer can still be funded]

The contract checks the deadline in one place: liquidating an active loan. Funding a pending offer does not consult it, and neither does cancelling. The app hides the funding action once the deadline block has passed, but that is only a check in the interface. A transaction built outside the app is still valid.

Leaving an expired offer open means a lender can fund it and liquidate immediately afterwards, because the loan is already past its deadline. The collateral comes back when the borrower cancels, and cancellation stays possible for as long as the offer is pending.

:::

:::warning[Claim the principal before repaying]

The app offers repayment only after the principal has been claimed. The contract accepts a full repayment before that claim. The repayment burns the borrower NFT, and [claiming the principal](../borrower/claim-principal.md) is an [asset auth](../contracts/asset-auth.md) spend that needs the same NFT. Once the repayment confirms, that output stays locked and the claim can no longer be made.

:::

:::warning[Repay before the deadline, not on it]

There is no grace period on an active loan. Liquidation becomes available the moment the deadline block is reached, and the contract does not block repayment after that point either. Both transactions are valid at the same time, and the position goes to whichever one confirms first. A late borrower is relying on the lender not having broadcast yet.

Leave margin instead of planning to repay on the final day. The deadline is a block height, and [Offer parameters](./offer-parameters.md) explains how the app turns a number of days into one.

:::
