# Preparation steps

## Issue principal asset

```bash
cargo run -p lending-cli -- utility issue-asset --asset-amount 50000
```

Issuing new asset with id - 3cc22e157739d0bab9b1015396d7cfacf67b9a66275454e049dcef7bae8ea8f8 and amount - 50000
New asset successfully issued!
Broadcast txid: 47d1362026b7240e4403549c24b6b8c6ab37ed0fcf061d335b72b34362dfdf6f

## Prepare UTXOs for utility NFTs issuance

```bash
cargo run -p lending-cli -- utility issue-preparation-utxos
```

Issuing preparation UTXOs with the a4757bb6ea736c76033fa278600e8151ff289252e29251f42114a0fb84478531 asset id...
Preparation UTXOs successfully issued!
Broadcast txid: a03cb1fa432dbab2d900f812f49caff6219106edc55aa5bd6318e69af5fc4de9

# Lending covenant creation

## Utility NFTs issuance

Loan offer params:
1. Collateral amount - 1000
2. Principal amount - 5000
3. Interest rate - 500 (5%)
4. Loan expiration time (height) - 2375600

```bash
cargo run -p lending-cli -- utility issue-utility-nfts --preparation-utxos-asset-id-hex-be a4757bb6ea736c76033fa278600e8151ff289252e29251f42114a0fb84478531 --collateral-amount 1000 --principal-amount 
5000 --loan-expiration-time 2375600 --principal-interest-rate 500
```

Issuing utility NFTs with the next offer parameters: LendingOfferParameters { collateral_amount: 1000, principal_amount: 5000, loan_expiration_time: 2375600, principal_interest_rate: 500 }
Utility NFTs successfully created!
Broadcast txid: 00001cf9494d8fced6fa1bd0389b31c655b028899a4a2c2ab997947505e4fefc

## Pre lock creation

```bash
cargo run -p lending-cli -- pre-lock create --utility-nfts-issuance-txid 00001cf9494d8fced6fa1bd0389b31c655b028899a4a2c2ab997947505e4fefc --collateral-asset-id-hex-be 144c654344aa716d6f3abcc1ca90e5641e4e2a7f633bc09fe3baf64585819a49 --principal-asset-id-hex-be 3cc22e157739d0bab9b1015396d7cfacf67b9a66275454e049dcef7bae8ea8f8
```

Creating Lending offer with next parameters: PreLockParameters { collateral_asset_id: 144c654344aa716d6f3abcc1ca90e5641e4e2a7f633bc09fe3baf64585819a49, principal_asset_id: 3cc22e157739d0bab9b1015396d7cfacf67b9a66275454e049dcef7bae8ea8f8, first_parameters_nft_asset_id: 433794ec49f7e6f27344490b1c7581a0d9cc9a4a4141f89e61dad0e85d665d32, second_parameters_nft_asset_id: aa298933d79bca09a0bb03603550c7b25d1af2df6779f1474ddb01861f83408e, borrower_nft_asset_id: 98e27b5a12cac9e17452102235a5e4f74bcbaba573f3072994643dbc3a84df21, lender_nft_asset_id: 6a04e3125a882278dea2eaa94f7260d5ea073b691bb81aececfb12114f1930ba, offer_parameters: LendingOfferParameters { collateral_amount: 1000, principal_amount: 5000, loan_expiration_time: 2375600, principal_interest_rate: 500 }, borrower_pubkey: XOnlyPublicKey(4acb42e74dcbc5cd7855a5e1009626c7d65e16f45b366aa0c72b1dba6afce0599cc089644cd715aea0e277ead132920a61930176a5a0f434f2fe3bd0c290e4a8), borrower_output_script_hash: [150, 218, 59, 248, 56, 165, 36, 188, 145, 234, 56, 189, 251, 18, 37, 65, 26, 155, 245, 93, 200, 54, 163, 102, 109, 39, 235, 238, 21, 175, 200, 167], network: LiquidTestnet }
Lending offer successfully created!
Broadcast txid: 33c5882114e8654d0a64a77805585990fefd41d043f3c1b4664f62941f32d130

## Send principal assets to the second user

```bash
cargo run -p lending-cli -- account send-asset --to-address tex1qytt7upplzuaqs7ctyks0gj9lus9ks4mu0537xf --asset-id-hex-be 3cc22e157739d0bab9b1015396d7cfacf67b9a66275454e049dcef7bae8ea8f8 --amount 20000
```

Sending 20000 of the 3cc22e157739d0bab9b1015396d7cfacf67b9a66275454e049dcef7bae8ea8f8 asset to the tex1qytt7upplzuaqs7ctyks0gj9lus9ks4mu0537xf
Successfully sent 20000 of the 3cc22e157739d0bab9b1015396d7cfacf67b9a66275454e049dcef7bae8ea8f8 asset to the tex1qytt7upplzuaqs7ctyks0gj9lus9ks4mu0537xf
Broadcast txid: 8eb3199eb0c18a9a0057cb5c2a68536bf824b8aec49c342af0c28c5af8a4181c

## Creating principal UTXO with the exact principal amount

```bash
cargo run -p lending-cli -- account split-utxo --outpoint 8eb3199eb0c18a9a0057cb5c2a68536bf824b8aec49c342af0c28c5af8a4181c:0 --amounts 5000
```

Splitting UTXO with OutPoint { txid: 8eb3199eb0c18a9a0057cb5c2a68536bf824b8aec49c342af0c28c5af8a4181c, vout: 0 } outpoint
UTXO successfully split!
Broadcast txid: 1dc0b957ac949a0d0348d367b8d42a38608e012da51f956a013920a0cbdcb845

## Lending creation

```bash
cargo run -p lending-cli -- pre-lock create-lending --pre-lock-creation-txid 33c5882114e8654d0a64a77805585990fefd41d043f3c1b4664f62941f32d130
```

Activating Lending offer...
Lending offer successfully activated!
Broadcast txid: 6da8ee1843054e9693de901f8aac53bb06051531b8d21079c72f147aa1e5f8b2

# Loan repayment

## Repay the loan

```bash
cargo run -p lending-cli -- lending repay --lending-creation-txid 6da8ee1843054e9693de901f8aac53bb06051531b8d21079c72f147aa1e5f8b2
```

Repaying the loan...
Loan successfully repaid!
Broadcast txid: bf958fecc7b640b61bbba6e171f8408dd84ed9852c0f38374f5c47bab2e4c9cb

## Claim principal asset

```bash
cargo run -p lending-cli -- lending claim --lending-creation-txid 6da8ee1843054e9693de901f8aac53bb06051531b8d21079c72f147aa1e5f8b2 --lending-repayment-txid bf958fecc7b640b61bbba6e171f8408dd84ed9852c0f38374f5c47bab2e4c9cb
```

Claiming principal with interest...
Principal assets successfully claimed!
Broadcast txid: 63730307fd8aba7149af652c4521174686af522c52db1f458187de879f5e37cd