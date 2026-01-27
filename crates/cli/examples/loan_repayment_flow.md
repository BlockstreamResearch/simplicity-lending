# Preparation steps

## Print borrower address

```bash
cargo run -p lending-cli -- basic address 3
```

X Only Public Key: 271e7783510c485103a5809fd662e58453a50769a95a2ed4788544577ba1551a
P2PK Address: tex1phytlyz3z2t5naghrl867u378566q5tq6x39f8p4a5kcgtpzxw39qllaev3
Script hash: 986b58e5a21811ea8b1e5996a6796369405e583a3b178c43d9be35be84b64102

## Print lender address

```bash
cargo run -p lending-cli -- basic address 4
```

X Only Public Key: 398f025f04eae81b0bebc6a1571fcd1774f66a0f0cbd194823bdbab9b8c2cf1a
P2PK Address: tex1pxe8fcamzn8wj6w9hcakqrnm85sruc24q2jpz77x3sq4c4u5fwknqugp7f0
Script hash: 6b0d27da244286b05379923c7c59f2b7d1a6f89c0018f170d85b2db01c1fa642

## Fund borrower address with native asset

```bash
cargo run -p lending-cli -- basic transfer-native --utxo e3111751ea1bb1f5f3c3d36ee9f7c4561614734db866538a04c36df77b52a452:1 --to-address tex1phytlyz3z2t5naghrl867u378566q5tq6x39f8p4a5kcgtpzxw39qllaev3 --send-sats 50000 --fee-sats 60 --account-index 1 --broadcast
```

Broadcasted txid: 5391eb22c2b5855f663e4e945cebcbe87517fe6b9387c294dbbb4ec10e311fb5

```bash
cargo run -p lending-cli -- basic transfer-native --utxo b2bddf5a5b1d6f0dbf81206311dceba995384ad53083d2824f36bd34c5378cdb:6 --to-address tex1phytlyz3z2t5naghrl867u378566q5tq6x39f8p4a5kcgtpzxw39qllaev3 --send-sats 600 --fee-sats 60 --account-index 1 --broadcast
```

Broadcasted txid: a015b07317ca6f93460f2199c8d8d6c73975470ee7f27747c944684a2d0eba03

## Fund borrower address with principal asset

```bash
cargo run -p lending-cli -- basic transfer-asset --asset-utxo cd2b68094cec242aaa668132cccb643289d7adb90e6dfb04a625ba92ffbe400e:1 --fee-utxo b2bddf5a5b1d6f0dbf81206311dceba995384ad53083d2824f36bd34c5378cdb:5 --to-address tex1phytlyz3z2t5naghrl867u378566q5tq6x39f8p4a5kcgtpzxw39qllaev3 --send-sats 50000 --fee-sats 60 --account-index 1 --broadcast
```

Broadcasted txid: 3729f1344198fe46b281269e19d9288614543671b84a621aa857ef2717bd853d

## Fund lender address with native asset

```bash
cargo run -p lending-cli -- basic transfer-native --utxo b2bddf5a5b1d6f0dbf81206311dceba995384ad53083d2824f36bd34c5378cdb:7 --to-address tex1pxe8fcamzn8wj6w9hcakqrnm85sruc24q2jpz77x3sq4c4u5fwknqugp7f0 --send-sats 800 --fee-sats 60 --account-index 1 --broadcast
```

Broadcasted txid: cbe2406c55cde4ff2164e8e04d8d001c03f36bfd3db4bcd99d13db2ebaad3f56

## Fund lender address with principal asset

```bash
cargo run -p lending-cli -- basic transfer-asset --asset-utxo 3729f1344198fe46b281269e19d9288614543671b84a621aa857ef2717bd853d:1 --fee-utxo 3729f1344198fe46b281269e19d9288614543671b84a621aa857ef2717bd853d:2 --to-address tex1pxe8fcamzn8wj6w9hcakqrnm85sruc24q2jpz77x3sq4c4u5fwknqugp7f0 --send-sats 50000 --fee-sats 60 --account-index 1 --broadcast
```

Broadcasted txid: b80ed05e00c90fcbe68d4248a876f016d6bb2ef1f54606aa47d627c2e2456d9b

## Split lender's principal asset

```bash
cargo run -p lending-cli -- basic transfer-asset --asset-utxo b80ed05e00c90fcbe68d4248a876f016d6bb2ef1f54606aa47d627c2e2456d9b:0 --fee-utxo cbe2406c55cde4ff2164e8e04d8d001c03f36bfd3db4bcd99d13db2ebaad3f56:0 --to-address tex1pxe8fcamzn8wj6w9hcakqrnm85sruc24q2jpz77x3sq4c4u5fwknqugp7f0 --send-sats 5000 --fee-sats 60 --account-index 4 --broadcast
```

## Prepare UTXOs for utility NFTs issuance

```bash
cargo run -p lending-cli -- pre-lock prepare-utility-nfts-issuance --fee-utxo 5391eb22c2b5855f663e4e945cebcbe87517fe6b9387c294dbbb4ec10e311fb5:0 --to-address tex1phytlyz3z2t5naghrl867u378566q5tq6x39f8p4a5kcgtpzxw39qllaev3 --account-index 3 --fee-amount 80 --broadcast
```

Broadcasted txid: 24af158ee1e954b64965b6b8131c491fda8da5536f5b8d2e15e594d153cba8f9

# Lending covenant creation

## Utility NFTs issuance

Loan offer params:
1. Collateral amount - 1000
2. Principal amount - 5000
3. Interest rate - 500 (5%)
4. Loan expiration time (height) - 2287169

```bash
cargo run -p lending-cli -- pre-lock issue-utility-nfts-from-tx --pre-issuance-tx-id 24af158ee1e954b64965b6b8131c491fda8da5536f5b8d2e15e594d153cba8f9 --fee-utxo 24af158ee1e954b64965b6b8131c491fda8da5536f5b8d2e15e594d153cba8f9:4 --to-address tex1phytlyz3z2t5naghrl867u378566q5tq6x39f8p4a5kcgtpzxw39qllaev3 --first-issuance-utxo-index 0 --collateral-amount 1000 --principal-amount 5000 --loan-expiration-time 2287169 --principal-interest-rate 500 --tokens-decimals 2 --account-index 3 --fee-amount 200 --broadcast
```

Broadcasted txid: 7064325076f0e5bc5baa62c80085b8e4f8af0958adcb915d9d1bbab21e9eb109

## Pre lock creation

Lending covenant hash: 44a276d07dc4a5e0d7d9e6309e85080266a42c7808c63da17c8c16ffa60760d7
Pre lock taproot pubkey gen: ef88e8102424dde9e16a0c4674616a2e12f9859feaf1f63dbc83099748492d78:02b4fdf7c04cb5eef0223953e2dcea93d34e7c0781216f349ef3e9bf838caae1c6:tex1p0thfgvn699qq73aghuq5llt2ny5fsptzsn543gtqksvkjjznc2csxu55dz

```bash
cargo run -p lending-cli -- pre-lock create --collateral-utxo 7064325076f0e5bc5baa62c80085b8e4f8af0958adcb915d9d1bbab21e9eb109:8 --first-parameters-nft-utxo 7064325076f0e5bc5baa62c80085b8e4f8af0958adcb915d9d1bbab21e9eb109:2 --second-parameters-nft-utxo 7064325076f0e5bc5baa62c80085b8e4f8af0958adcb915d9d1bbab21e9eb109:3 --borrower-nft-utxo 7064325076f0e5bc5baa62c80085b8e4f8af0958adcb915d9d1bbab21e9eb109:0 --lender-nft-utxo 7064325076f0e5bc5baa62c80085b8e4f8af0958adcb915d9d1bbab21e9eb109:1 --fee-utxo a015b07317ca6f93460f2199c8d8d6c73975470ee7f27747c944684a2d0eba03:0 --principal-asset-id-hex-be 5add42b2dfeea8fe664bad6073e320518bb2be5c88357973091e9e278ce7084c --to-address tex1phytlyz3z2t5naghrl867u378566q5tq6x39f8p4a5kcgtpzxw39qllaev3 --account-index 3 --fee-amount 180 --broadcast
```

Broadcasted txid: 6a098dcb9e34d4cff07c84c10cf2704c7e4a5b7518e401a7cde20b4b48e615c5

## Print pre lock info

```bash
cargo run -p lending-cli -- pre-lock show-info --pre-lock-tx-id 6a098dcb9e34d4cff07c84c10cf2704c7e4a5b7518e401a7cde20b4b48e615c5
```

Pre Lock covenant info:
Assets Info:
    Collateral asset id: 144c654344aa716d6f3abcc1ca90e5641e4e2a7f633bc09fe3baf64585819a49
    First Parameters NFT asset id: 05b82e9ef1ae518f500e27d3d879107b155c2514eb5549cb54c28c5b0d47a1fa
    Second Parameters NFT asset id: 5916595b5d4b24a90739e36825677eab7147442854a213c48742737150a270bd
    Borrower NFT asset id: 655f2408e1efa24ad25df5191b46a379b72a1b959122396f50a9d270beffde6b
    Lender NFT asset id: c9a49d5514c34f67b53a9e7d5f888875522073e6d3648b71af5cd0f645f7974e
Lending Offer Info:
    Borrower public key: 271e7783510c485103a5809fd662e58453a50769a95a2ed4788544577ba1551a
    Collateral amount: 1000
    Principal amount: 5000
    Loan expiration time (block height): 2287169
    Principal interest rate (100% = 10_000): 500

## Lending creation

```bash
cargo run -p lending-cli -- pre-lock create-lending --pre-lock-utxo 6a098dcb9e34d4cff07c84c10cf2704c7e4a5b7518e401a7cde20b4b48e615c5:0 --principal-utxo 9c6cff15eead4ae1ae4569a094b7135b268f12aa1d0862972e72d063570401a2:0 --first-parameters-nft-utxo 6a098dcb9e34d4cff07c84c10cf2704c7e4a5b7518e401a7cde20b4b48e615c5:1 --second-parameters-nft-utxo 6a098dcb9e34d4cff07c84c10cf2704c7e4a5b7518e401a7cde20b4b48e615c5:2 --borrower-nft-utxo 6a098dcb9e34d4cff07c84c10cf2704c7e4a5b7518e401a7cde20b4b48e615c5:3 --lender-nft-utxo 6a098dcb9e34d4cff07c84c10cf2704c7e4a5b7518e401a7cde20b4b48e615c5:4 --fee-utxo 9c6cff15eead4ae1ae4569a094b7135b268f12aa1d0862972e72d063570401a2:2 --pre-lock-taproot-pubkey-gen ef88e8102424dde9e16a0c4674616a2e12f9859feaf1f63dbc83099748492d78:02b4fdf7c04cb5eef0223953e2dcea93d34e7c0781216f349ef3e9bf838caae1c6:tex1p0thfgvn699qq73aghuq5llt2ny5fsptzsn543gtqksvkjjznc2csxu55dz --to-address tex1pxe8fcamzn8wj6w9hcakqrnm85sruc24q2jpz77x3sq4c4u5fwknqugp7f0 --account-index 4 --fee-amount 240 --broadcast
```

Broadcasted txid: 6160dd126d357afc938faeb78b44ad77c076124e06941f1727162e151c38df22

# Loan repayment

## Create principal with interest UTXO

Principal amount - 5000
Principal interest amount - 250 (5% from 5000)

```bash
cargo run -p lending-cli -- basic transfer-asset --asset-utxo 3729f1344198fe46b281269e19d9288614543671b84a621aa857ef2717bd853d:0 --fee-utxo 6a098dcb9e34d4cff07c84c10cf2704c7e4a5b7518e401a7cde20b4b48e615c5:6 --to-address tex1phytlyz3z2t5naghrl867u378566q5tq6x39f8p4a5kcgtpzxw39qllaev3 --send-sats 5250 --fee-sats 60 --account-index 3 --broadcast
```

Broadcasted txid: aab49b2764ce34857f30565e281eb77639da0c8a95ced2ec47ea123da78d8b2f

## Loan repayment

```bash
cargo run -p lending-cli -- lending repay --lending-utxo 6160dd126d357afc938faeb78b44ad77c076124e06941f1727162e151c38df22:0 --principal-utxo aab49b2764ce34857f30565e281eb77639da0c8a95ced2ec47ea123da78d8b2f:0 --first-parameters-nft-utxo 6160dd126d357afc938faeb78b44ad77c076124e06941f1727162e151c38df22:2 --second-parameters-nft-utxo 6160dd126d357afc938faeb78b44ad77c076124e06941f1727162e151c38df22:3 --borrower-nft-utxo 6160dd126d357afc938faeb78b44ad77c076124e06941f1727162e151c38df22:4 --fee-utxo aab49b2764ce34857f30565e281eb77639da0c8a95ced2ec47ea123da78d8b2f:2 --lending-cov-hash 44a276d07dc4a5e0d7d9e6309e85080266a42c7808c63da17c8c16ffa60760d7 --to-address tex1phytlyz3z2t5naghrl867u378566q5tq6x39f8p4a5kcgtpzxw39qllaev3 --account-index 3 --fee-amount 210 --broadcast
```

Broadcasted txid: f6fe49936581e1eb1c381965adcca7c4e79ffb671bedfc8a4dfa40f20cf5d526

## Claim principal asset

```bash
cargo run -p lending-cli -- asset-auth unlock-with-arguments --locked-utxo f6fe49936581e1eb1c381965adcca7c4e79ffb671bedfc8a4dfa40f20cf5d526:1 --auth-utxo 6160dd126d357afc938faeb78b44ad77c076124e06941f1727162e151c38df22:5 --fee-utxo 6160dd126d357afc938faeb78b44ad77c076124e06941f1727162e151c38df22:6 --auth-asset-id-hex-be c9a49d5514c34f67b53a9e7d5f888875522073e6d3648b71af5cd0f645f7974e --auth-asset-amount 1 --with-asset-burn --account-index 4 --fee-amount 80 --broadcast
```

Broadcasted txid: 4e2b5cde0c32e510693c48d53c310c054bce0e87f8b3d66471af6659b9339f15