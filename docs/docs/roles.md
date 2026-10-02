# Roles

## Borrower

The borrower creates an offer, locks collateral, and sets the loan amount, fee, and term. After a lender funds the offer, the borrower receives the principal. Before expiry they can repay principal and interest and take the collateral back. Until a lender accepts, the borrower can cancel the offer.

## Lender

The lender reviews open offers and funds one by providing principal. That principal stays with the borrower until repayment or expiry. If the borrower repays, the lender claims principal and interest. If the term ends unpaid, the lender can liquidate the position and claim the collateral.

A protocol fee is taken from the lender's fee. It is not a separate role in the app.
