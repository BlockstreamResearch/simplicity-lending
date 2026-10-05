---
description: Which actions a borrower and a lender can take, when each one is available, and which token authorizes it.
---

# Roles

Two parties take part in a loan. The borrower publishes an offer and locks collateral. The lender funds that offer and is repaid, or claims the collateral if the deadline passes unpaid.

Holding the role token is what makes someone the borrower or the lender of a given offer. A pending offer has no lender yet, so anyone can fund it. Funding moves the lender NFT into that person's wallet, and from then on the role belongs to whoever holds the token.

## What each role can do

The offer moves through a few states, and the state decides which action is open. The steps themselves are written up under [Borrower](../borrower/create-account.md) and [Lender](../lender/review-offer.md). A borrower starts with [Create an account](../borrower/create-account.md).

| Action | Role | When | Authorization |
| --- | --- | --- | --- |
| Publish an offer | Borrower | The borrower has an account | The account mints the two role tokens. The borrower NFT goes to the borrower's wallet. The lender NFT waits in a contract output tied to the offer |
| Cancel the offer | Borrower | The offer is still pending, whether or not its deadline has passed | Both role tokens. The lender NFT is still in the contract output, so the borrower can cancel without a lender |
| Fund the offer | Lender | The offer is pending, including after its deadline | The lender NFT moves out of the contract output and into the lender's wallet |
| Claim the principal | Borrower | The offer is active and the principal has not been claimed yet. Also after liquidation, if it was never claimed | The principal output created when the offer was funded |
| Repay | Borrower | The offer is active and the principal has been claimed | The borrower NFT. A partial repayment returns it. Repaying the rest burns it and releases the collateral |
| Liquidate | Lender | The offer is active and the deadline block has been reached | The lender NFT, which the transaction burns. The collateral goes to the lender |
| Claim the repayment | Lender | The borrower has repaid | The repayment held for the lender |

Once an offer is cancelled, or the lender has claimed the repayment, neither party has anything left to do with it.

:::warning[An expired offer can still be funded]

The contract checks the deadline in one place: liquidating an active loan. Funding a pending offer does not consult it, and neither does cancelling. The app hides the funding action once the deadline block has passed, but that is only a check in the interface. A transaction built outside the app is still valid.

Leaving an expired offer open means a lender can fund it and liquidate immediately afterwards, because the loan is already past its deadline. The collateral comes back when the borrower cancels, and cancellation stays possible for as long as the offer is pending.

:::
