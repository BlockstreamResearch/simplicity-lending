# Offer parameters

An offer states the collateral amount, the principal the borrower wants to receive, the fee they will pay on top of that principal, and how long the loan lasts.

The fee is set as an interest rate in basis points and does not accrue over time: the amount owed is that rate applied to the loan amount, and it is the same whether the loan is repaid early or on the last day. The app accepts the fee as an amount and divides it by the loan amount to get the rate, rounding down, so the fee the contract enforces can end up slightly below the amount that was typed.

APR in the app annualizes that fee against the loan amount and the term. The protocol fee is a share of the lender's fee and is not included in the displayed APR.

The term is a number of blocks counted from the block in which the offer is created. The app offers terms of 7, 14, 30, and 90 days and converts them to blocks assuming roughly one Liquid block per minute, so the deadline in wall-clock time is approximate — what the contract enforces is the block height.

LTV compares the loan amount to the current value of the collateral. The app refuses an offer above its maximum LTV. Liquidation itself follows the term, not the price.
