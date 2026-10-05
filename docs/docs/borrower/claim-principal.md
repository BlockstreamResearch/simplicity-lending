# Claim the principal

When a lender funds the offer, the principal is paid into an output the borrower does not hold yet. It stays locked to the borrower NFT until the borrower claims it. The claim spends that output and the borrower NFT together, pays the principal to the borrower's wallet, and returns the borrower NFT. The token is not burned, because the borrower still needs it to repay.

The offer has to be active, or already liquidated if the principal was never claimed. Until the claim is done, the app offers no repayment action.

<details>
<summary>Transaction structure</summary>

Inputs and outputs for claiming the principal will be documented here.

</details>
