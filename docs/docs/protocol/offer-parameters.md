---
description: The four fields an offer fixes when it is created — collateral, principal, fee, and term — and the loan-to-value check the app applies on top.
---

# Offer parameters

An offer fixes four things when it is created: how much collateral is locked, how much principal the borrower wants, the fee on top of that principal, and how long the loan lasts. All four become parameters of the contract, so publishing an offer with different values means publishing a different contract. Nothing here can be edited afterwards.

On Liquid testnet the collateral asset is tL-BTC and the principal asset is TEST. The amounts below are in those assets.

## Collateral

The collateral is the amount of tL-BTC the borrower locks in the contract. It stays there until the offer is cancelled, repaid in full, or liquidated. The lender is paid from it only in that last case.

## Principal

The principal is the amount of TEST the borrower wants to receive. The app requires at least 0.1 TEST. The lender provides it when funding the offer, and it sits in an output the borrower then claims. Until that claim, the app offers no repayment action.

## Fee

The fee is an interest rate in basis points, fixed for the whole term. A basis point is a hundredth of a percent, and 10000 of them make 100%, so the amount owed on top of the principal is `principal × rate ÷ 10000`. A rate of 500 is 5%: 1000 TEST borrowed costs 50 TEST, and the borrower repays 1050 TEST. The rate does not accrue. Repaying on the first day costs the same as repaying on the last.

The app lets the borrower type the fee as an amount. It divides that amount by the principal, keeps the whole number of basis points, and stores the rate. Both that division and the contract's own multiplication round down, so the fee the contract actually collects can come out slightly below the amount that was typed. The smallest fee the app accepts is 0.1 TEST, and the rate has to fit in the field the contract stores, which tops out at 65535 basis points, or 655.35%.

The app also shows an APR. That figure annualizes the fee against the principal and the term so offers of different lengths can be compared. It is not a rate the contract charges, and it is computed from the whole fee. The protocol keeps 10% of the fee as it is paid, so a lender's return is about a tenth lower than the APR on screen. The borrower still owes the full fee.

## Term

The term is a block height: the height of the block the offer is created in, plus a number of blocks chosen up front. The app offers 7, 14, 30, and 90 days and converts them at roughly one Liquid block per minute, so 7 days is 10080 blocks. Blocks are not exactly one minute apart, so the deadline in clock time is an estimate.

Which actions this height blocks is covered in [Roles](./roles.md).

## Loan-to-value

Loan-to-value is not one of the four fields, and the contract does not store it. The app compares the principal with the current value of the collateral and refuses to publish an offer above 55%. That check happens once, at creation, and it is not repeated afterwards. A fall in the collateral's price during the term does not liquidate the loan. Only the deadline does.

How these values are entered is covered in [Create an offer](../borrower/create-offer.md). What a lender sees before funding is covered in [Review an offer](../lender/review-offer.md).
