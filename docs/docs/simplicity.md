# Simplicity

Lending contracts are written in [SimplicityHL](https://docs.simplicity-lang.org/simplicityhl-reference/) and compile to [Simplicity](https://docs.simplicity-lang.org/).

Simplicity is a smart contract language for Bitcoin-like blockchains. On Liquid, a Simplicity contract is the spending condition of a UTXO: the collateral stays in that output, and only a transaction the contract accepts can move it. Resource use is known before the transaction is funded.

The language reference is the place for syntax, jets, and program structure. This site describes how the lending protocol uses those contracts.
