import { describe, expect, it } from 'vitest'
import { buildP2pkArguments } from '../simplicity/covenants'
import { createP2trAddress, getLwk, getSource } from '../simplicity'
import {
  getTaprootUnspendableInternalKey,
  TAPROOT_UNSPENDABLE_INTERNAL_KEY_BYTES,
} from '../utility/taprootUnspendableKey'
import { bytesToHex } from '../utility/hex'
import type { EsploraTx } from '../api/esplora'
import type { OfferShort } from '../types/offers'
import {
  createAcceptOfferRequest,
  createLiquidateLoanRequest,
  createPreLockRequest,
  createRepayLoanRequest,
} from './requests'

const ACCEPT_OFFER: OfferShort = {
  id: 'f2437579-9624-4893-a368-a03859d89082',
  status: 'pending',
  collateral_asset: '144c654344aa716d6f3abcc1ca90e5641e4e2a7f633bc09fe3baf64585819a49',
  principal_asset: '38fca2d939696061a8f76d4e6b5eecd54e3b4221c846f24a6b279e79952850a5',
  collateral_amount: 100n,
  principal_amount: 500n,
  interest_rate: 300,
  loan_expiration_time: 2_406_798,
  created_at_height: 2_406_792n,
  created_at_txid: 'e8ef5e80f1881ad8ddec3bfddf2c837df47646bf1dfc5b8f985a60587556492e',
}

const ACCEPT_OFFER_CREATION_TX: EsploraTx = {
  txid: ACCEPT_OFFER.created_at_txid,
  vin: [
    {
      prevout: {
        scriptpubkey: '0014a12df653b097e3d8c7767d9e2492a62f7756021b',
        value: 149691313291564,
        asset: '9e7f3512908401606a3a34b7bc97e852b08637d38dc5e96cfd6e283a4e397f0c',
      },
    },
  ],
  vout: [
    {
      scriptpubkey: '5120e367f66ee96a0cf375f949f37fa0927eb331dc3b46216a7f12f6d6a7dc7b90dc',
      value: 100,
      asset: '144c654344aa716d6f3abcc1ca90e5641e4e2a7f633bc09fe3baf64585819a49',
    },
    {
      value: 149691313291564,
      asset: '9e7f3512908401606a3a34b7bc97e852b08637d38dc5e96cfd6e283a4e397f0c',
    },
    {
      value: 1677721610,
      asset: 'f129a16748e5fe9ce67f85b09f8f6cb435e9d879c7ae05691312fa8d9035d20e',
    },
    {
      value: 1,
      asset: '099054f40822d453dc8f78b8ffa73c4d3b66ca194ed48d169fdc45c94655d68e',
    },
    {
      value: 1,
      asset: '4b24961b3e212e6bbe7259346f5c78cd9be79479f279aa64d7230323523b04a9',
    },
    {
      scriptpubkey:
        '6a40955be61b949fed52dfd6768a0c0fe8840bbf6c321dd02ef7699c79e1e513efafa5502895799e276b4af246c821423b4ed5ec5e6b4e6df7a861606939d9a2fc38',
      value: 0,
      asset: '0000000000000000000000000000000000000000000000000000000000000000',
    },
  ],
}

const LENDING_TX: EsploraTx = {
  txid: 'c4b4845cc3573b3b336d4b2affce35afdaa160b1719600793436021938e96fe1',
  vin: [],
  vout: [
    {
      scriptpubkey: '51203a1b9a368601bd128c77d606571404c56d6c4c07f8c4657899488a97d93aa972',
      value: 100,
      asset: ACCEPT_OFFER.collateral_asset,
    },
    {
      scriptpubkey: '0014a12df653b097e3d8c7767d9e2492a62f7756021b',
      value: 500,
      asset: ACCEPT_OFFER.principal_asset,
    },
    {
      scriptpubkey: '51208e5640de8561b5e40ce3ee8c4f5d89be34d9871a1ec7b0f0f84f7b28bdd3d338',
      value: 149691313291564,
      asset: '9e7f3512908401606a3a34b7bc97e852b08637d38dc5e96cfd6e283a4e397f0c',
    },
    {
      scriptpubkey: '51208e5640de8561b5e40ce3ee8c4f5d89be34d9871a1ec7b0f0f84f7b28bdd3d338',
      value: 1677721610,
      asset: 'f129a16748e5fe9ce67f85b09f8f6cb435e9d879c7ae05691312fa8d9035d20e',
    },
    {
      scriptpubkey: '0014a12df653b097e3d8c7767d9e2492a62f7756021b',
      value: 1,
      asset: '099054f40822d453dc8f78b8ffa73c4d3b66ca194ed48d169fdc45c94655d68e',
    },
    {
      scriptpubkey: '001403683ad989e6d2bf23fb3afd3fecf30cb8768ac1',
      value: 1,
      asset: '4b24961b3e212e6bbe7259346f5c78cd9be79479f279aa64d7230323523b04a9',
    },
  ],
}

describe('createPreLockRequest', () => {
  it('builds the pre-lock creation request JSON', async () => {
    const lwk = await getLwk()
    const borrowerPubkeyHex = bytesToHex(TAPROOT_UNSPENDABLE_INTERNAL_KEY_BYTES)
    const borrowerAddress = await createP2trAddress({
      source: getSource('p2pk'),
      args: buildP2pkArguments(lwk, { publicKeyHex: borrowerPubkeyHex }),
      internalKey: getTaprootUnspendableInternalKey(lwk),
      network: 'testnet',
    })

    const { request } = await createPreLockRequest({
      borrowerAddress,
      borrowerPubkeyHex,
      principalAssetId: '1111111111111111111111111111111111111111111111111111111111111111',
      firstParametersNftAssetId: '2222222222222222222222222222222222222222222222222222222222222222',
      secondParametersNftAssetId:
        '3333333333333333333333333333333333333333333333333333333333333333',
      borrowerNftAssetId: '4444444444444444444444444444444444444444444444444444444444444444',
      lenderNftAssetId: '5555555555555555555555555555555555555555555555555555555555555555',
      collateralAmount: 1_000n,
      principalAmount: 5_000n,
      loanExpirationTime: 2_407_000,
      interestRateBasisPoints: 200,
    })

    expect(
      request
        .params()
        .outputs()
        .map((output) => output.id())
    ).toEqual([
      'locked-collateral',
      'locked-first-parameter-nft',
      'locked-second-parameter-nft',
      'locked-borrower-nft',
      'locked-lender-nft',
      'creation-op-return',
    ])
    expect(request.broadcast()).toBe(true)
    expect(request.toJSON()).toMatchObject({ abi_version: 'wallet-abi-0.1' })
  })
})

describe('createAcceptOfferRequest', () => {
  it('builds distinct finalizers for every reused script-auth spend', async () => {
    const lenderAddress = await createP2trAddress({
      source: getSource('p2pk'),
      args: buildP2pkArguments(await getLwk(), {
        publicKeyHex: bytesToHex(TAPROOT_UNSPENDABLE_INTERNAL_KEY_BYTES),
      }),
      internalKey: getTaprootUnspendableInternalKey(await getLwk()),
      network: 'testnet',
    })

    const { request } = await createAcceptOfferRequest({
      offer: ACCEPT_OFFER,
      offerCreationTx: ACCEPT_OFFER_CREATION_TX,
      lenderAddress,
    })

    expect(
      request
        .params()
        .inputs()
        .map((input) => input.id())
    ).toEqual([
      'locked-collateral',
      'first-parameter-nft',
      'second-parameter-nft',
      'borrower-nft',
      'lender-nft',
    ])
    expect(
      request
        .params()
        .inputs()
        .map((input) => input.utxoSource().kind())
    ).toEqual(['provided', 'provided', 'provided', 'provided', 'provided'])
    expect(
      request
        .params()
        .inputs()
        .map((input) => input.unblinding().kind())
    ).toEqual(['explicit', 'explicit', 'explicit', 'explicit', 'explicit'])
    expect(
      request
        .params()
        .outputs()
        .map((output) => output.id())
    ).toEqual([
      'locked-collateral',
      'borrower-principal',
      'locked-first-parameter-nft',
      'locked-second-parameter-nft',
      'borrower-nft-output',
      'lender-nft-output',
    ])
  })
})

describe('createLiquidateLoanRequest', () => {
  it('uses the exact lender NFT outpoint instead of a wallet asset filter', async () => {
    const { request } = await createLiquidateLoanRequest({
      offer: { ...ACCEPT_OFFER, status: 'active' },
      lendingTx: LENDING_TX,
      lenderAddress: 'tex1qqd5r4kvfumft7glm8t7nlm8npju8dzkpjjjz7k',
      lenderNftAssetId: '4b24961b3e212e6bbe7259346f5c78cd9be79479f279aa64d7230323523b04a9',
    })

    const lenderNftInput = request.params().inputs()[3]

    expect(lenderNftInput?.id()).toBe('lender-nft')
    expect(lenderNftInput?.utxoSource().kind()).toBe('provided')
    const outpoint = lenderNftInput?.utxoSource().providedOutpoint()
    expect(outpoint?.txid().toString()).toBe(LENDING_TX.txid)
    expect(outpoint?.vout()).toBe(5)
    expect(lenderNftInput?.finalizer().kind()).toBe('wallet')
  })
})

describe('createRepayLoanRequest', () => {
  it('uses the exact borrower NFT outpoint instead of a wallet asset filter', async () => {
    const { request } = await createRepayLoanRequest({
      offer: { ...ACCEPT_OFFER, status: 'active' },
      lendingTx: LENDING_TX,
      borrowerAddress: 'tex1qqd5r4kvfumft7glm8t7nlm8npju8dzkpjjjz7k',
    })

    const borrowerNftInput = request.params().inputs()[3]

    expect(borrowerNftInput?.id()).toBe('borrower-nft')
    expect(borrowerNftInput?.utxoSource().kind()).toBe('provided')
    const outpoint = borrowerNftInput?.utxoSource().providedOutpoint()
    expect(outpoint?.txid().toString()).toBe(LENDING_TX.txid)
    expect(outpoint?.vout()).toBe(4)
    expect(borrowerNftInput?.finalizer().kind()).toBe('wallet')
  })
})
