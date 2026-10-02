# Offer parameters

An offer states the collateral amount, the principal the borrower wants to receive, the fee they will pay on top of that principal, and how long the loan lasts.

The fee is a fixed amount for the whole term. APR in the app annualizes that fee against the loan amount and the term. The protocol fee is a share of the lender's fee and is not included in the displayed APR.

LTV compares the loan amount to the current value of the collateral. The app refuses an offer above its maximum LTV. Liquidation itself follows the term, not the price.
