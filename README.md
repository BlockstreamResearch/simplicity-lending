# Simplicity lending protocol

A pure SimplicityHL implementation of a peer-to-peer lending protocol.

## High-level mechanics

Borrowers create "borrowing offers" with specified _collateral amount_, _lending duration_, and _principal asset amount_ (interest) they are willing to pay for the credit settlement. They also specify the _amount of principal_ they are willing to receive for the pledged collateral.

The Borrower can cancel the initial offer before it is accepted.

If a Lender is satisfied with such conditions, they provide principal to the borrower, creating a lending contract.

At any point in time before the lending contract expiry, the Borrower can repay the principal amount with interest and take their collateral back.

In case the Borrower fails to pay interest before the lending contract expiry, the Lender can liquidate the position and claim collateral for themselves.

## Repository structure

TODO

## How to use

TODO
