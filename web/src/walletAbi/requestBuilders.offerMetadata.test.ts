import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hexToBytes32 } from '../utility/hex'
import type { OfferShort } from '../types/offers'

const {
  mockComputePreLockCovenantHashes,
  mockBuildPreLockCancellationFinalizer,
  mockBuildPreLockCreationFinalizer,
  mockBuildScriptAuthFinalizer,
  mockBuildLendingFinalizer,
  mockBuildAssetAuthFinalizer,
} = vi.hoisted(() => ({
  mockComputePreLockCovenantHashes: vi.fn(),
  mockBuildPreLockCancellationFinalizer: vi.fn(),
  mockBuildPreLockCreationFinalizer: vi.fn(),
  mockBuildScriptAuthFinalizer: vi.fn(),
  mockBuildLendingFinalizer: vi.fn(),
  mockBuildAssetAuthFinalizer: vi.fn(),
}))

vi.mock('../utility/preLockCovenants', async () => {
  const actual = await vi.importActual<typeof import('../utility/preLockCovenants')>(
    '../utility/preLockCovenants'
  )
  return {
    ...actual,
    computePreLockCovenantHashes: mockComputePreLockCovenantHashes,
  }
})

vi.mock('./finalizers', () => ({
  buildAssetAuthFinalizer: mockBuildAssetAuthFinalizer,
  buildLendingFinalizer: mockBuildLendingFinalizer,
  buildPreLockCancellationFinalizer: mockBuildPreLockCancellationFinalizer,
  buildPreLockCreationFinalizer: mockBuildPreLockCreationFinalizer,
  buildScriptAuthFinalizer: mockBuildScriptAuthFinalizer,
}))

import {
  buildAcceptOfferRequest,
  buildCancelOfferRequest,
  buildLiquidateLoanRequest,
} from './requestBuilders'

const FEE_RATE_SAT_KVB = 543
const borrowerPubKeyHex = 'c7'.repeat(32)
const principalAssetHex = '1e'.repeat(32)
const collateralAssetHex = '14'.repeat(32)
const borrowerOutputScriptHashHex = '07'.repeat(32)
const borrowerOutputScriptPubkeyHex = '0014' + 'ab'.repeat(20)

function makeOffer(overrides: Partial<OfferShort> = {}): OfferShort {
  return {
    id: '43baea4b-6d05-430b-8afc-b7eb42168160',
    status: 'pending',
    collateral_asset: collateralAssetHex,
    principal_asset: principalAssetHex,
    collateral_amount: 1_000n,
    principal_amount: 15_000n,
    interest_rate: 500,
    loan_expiration_time: 2_343_554,
    created_at_height: 2_343_540n,
    created_at_txid: '1b'.repeat(32),
    ...overrides,
  }
}

function makeOfferCreationTx(borrowerOutputMetadataScriptHex: string) {
  return {
    txid: '1b'.repeat(32),
    vout: [
      { asset: collateralAssetHex, value: 1_000, scriptpubkey_hex: '5120' + '01'.repeat(32) },
      { asset: '3a'.repeat(32), value: 153590235636, scriptpubkey_hex: '5120' + '02'.repeat(32) },
      { asset: 'c2'.repeat(32), value: 503316481000, scriptpubkey_hex: '5120' + '02'.repeat(32) },
      { asset: '05'.repeat(32), value: 1, scriptpubkey_hex: '5120' + '02'.repeat(32) },
      { asset: '8b'.repeat(32), value: 1, scriptpubkey_hex: '5120' + '02'.repeat(32) },
      {
        asset: '00'.repeat(32),
        value: 0,
        scriptpubkey_hex: `6a40${borrowerPubKeyHex}${principalAssetHex}`,
      },
      {
        asset: '00'.repeat(32),
        value: 0,
        scriptpubkey_hex: borrowerOutputMetadataScriptHex,
      },
    ],
  }
}

function makeHashes(overrides: { borrowerScriptPubkeyHex?: string } = {}) {
  return {
    principalAuthScriptHash: hexToBytes32('11'.repeat(32)),
    lendingCovHash: hexToBytes32('22'.repeat(32)),
    parametersNftOutputScriptHash: hexToBytes32('33'.repeat(32)),
    borrowerOutputScriptHash: hexToBytes32(borrowerOutputScriptHashHex),
    borrowerP2trScriptHash: hexToBytes32(borrowerOutputScriptHashHex),
    preLockScriptHash: hexToBytes32('44'.repeat(32)),
    preLockAddressScriptPubkey: new Uint8Array(),
    utilityNftsOutputScriptPubkey: new Uint8Array(),
    borrowerScriptPubkeyHex: overrides.borrowerScriptPubkeyHex,
    preLockScriptPubkeyHex: '5120' + '55'.repeat(32),
    utilityNftsOutputScriptHex: '5120' + '66'.repeat(32),
    lendingScriptPubkeyHex: '5120' + '77'.repeat(32),
    parametersNftScriptPubkeyHex: '5120' + '88'.repeat(32),
  }
}

function makeLendingTx() {
  return {
    txid: '2a'.repeat(32),
    vout: [],
  }
}

function makeLenderParticipant() {
  return {
    offer_id: '43baea4b-6d05-430b-8afc-b7eb42168160',
    participant_type: 'lender' as const,
    script_pubkey: '5120' + '09'.repeat(32),
    txid: '3c'.repeat(32),
    vout: 4,
    created_at_height: 2_343_545,
    spent_txid: null,
    spent_at_height: null,
  }
}

describe('offer metadata handling', () => {
  beforeEach(() => {
    mockComputePreLockCovenantHashes.mockReset()
    mockBuildPreLockCancellationFinalizer.mockReset()
    mockBuildPreLockCreationFinalizer.mockReset()
    mockBuildScriptAuthFinalizer.mockReset()
    mockBuildLendingFinalizer.mockReset()
    mockBuildAssetAuthFinalizer.mockReset()

    mockBuildPreLockCancellationFinalizer.mockResolvedValue({ type: 'mock-pre-lock-cancel' })
    mockBuildPreLockCreationFinalizer.mockResolvedValue({ type: 'mock-pre-lock-create' })
    mockBuildScriptAuthFinalizer.mockResolvedValue({ type: 'mock-script-auth' })
    mockBuildLendingFinalizer.mockResolvedValue({ type: 'mock-lending' })
    mockBuildAssetAuthFinalizer.mockResolvedValue({ type: 'mock-asset-auth' })
  })

  it('buildCancelOfferRequest accepts hash-only offer metadata without a borrower script', async () => {
    mockComputePreLockCovenantHashes.mockResolvedValue(makeHashes())

    const request = await buildCancelOfferRequest({
      network: 'testnet-liquid',
      feeRateSatKvb: FEE_RATE_SAT_KVB,
      signingXOnlyPubkey: borrowerPubKeyHex,
      offer: makeOffer(),
      offerCreationTx: makeOfferCreationTx(`6a20${borrowerOutputScriptHashHex}`),
      collateralDestinationScriptPubkeyHex: borrowerOutputScriptPubkeyHex,
    })

    expect(mockComputePreLockCovenantHashes).toHaveBeenCalledWith(
      expect.objectContaining({
        borrowerOutputScriptPubkeyHex: undefined,
        borrowerOutputScriptHash: hexToBytes32(borrowerOutputScriptHashHex),
      })
    )
    expect(request.params.inputs.map((input) => input.id)).toEqual([
      'pre-lock',
      'first-parameters-script-auth',
      'second-parameters-script-auth',
      'borrower-script-auth',
      'lender-script-auth',
      'cancel-fee',
    ])
    expect(request.params.fee_rate_sat_kvb).toBe(FEE_RATE_SAT_KVB)
  })

  it('buildAcceptOfferRequest asks for a borrower address when the offer only stores a hash', async () => {
    mockComputePreLockCovenantHashes.mockResolvedValue(makeHashes())

    await expect(
      buildAcceptOfferRequest({
        network: 'testnet-liquid',
        feeRateSatKvb: FEE_RATE_SAT_KVB,
        signerScriptPubkeyHex: '0014' + 'cd'.repeat(20),
        offer: makeOffer(),
        offerCreationTx: makeOfferCreationTx(`6a20${borrowerOutputScriptHashHex}`),
      })
    ).rejects.toThrow(
      'Offer stores only the borrower output script hash. Enter the borrower destination address to accept it.'
    )
  })

  it('buildAcceptOfferRequest uses the embedded borrower script when the offer stores the full script', async () => {
    mockComputePreLockCovenantHashes.mockResolvedValue(
      makeHashes({ borrowerScriptPubkeyHex: borrowerOutputScriptPubkeyHex })
    )

    const request = await buildAcceptOfferRequest({
      network: 'testnet-liquid',
      feeRateSatKvb: FEE_RATE_SAT_KVB,
      signerScriptPubkeyHex: '0014' + 'cd'.repeat(20),
      offer: makeOffer(),
      offerCreationTx: makeOfferCreationTx(`6a16${borrowerOutputScriptPubkeyHex}`),
    })

    expect(mockComputePreLockCovenantHashes).toHaveBeenCalledWith(
      expect.objectContaining({
        borrowerOutputScriptPubkeyHex: borrowerOutputScriptPubkeyHex,
      })
    )
    expect(request.params.outputs.some((output) => output.id === 'principal-to-wallet')).toBe(true)
  })

  it('buildLiquidateLoanRequest enables absolute locktime on every input', async () => {
    const offer = makeOffer({ status: 'active' })
    mockComputePreLockCovenantHashes.mockResolvedValue(makeHashes())

    const request = await buildLiquidateLoanRequest({
      network: 'testnet-liquid',
      feeRateSatKvb: FEE_RATE_SAT_KVB,
      signerScriptPubkeyHex: '0014' + 'cd'.repeat(20),
      offer,
      offerCreationTx: makeOfferCreationTx(`6a20${borrowerOutputScriptHashHex}`),
      lendingTx: makeLendingTx(),
      lenderParticipant: makeLenderParticipant(),
      collateralDestinationScriptPubkeyHex: '0014' + 'ef'.repeat(20),
    })

    expect(mockBuildLendingFinalizer).toHaveBeenCalledWith(
      expect.objectContaining({ branch: 'LoanLiquidation' })
    )
    expect(request.params.lock_time).toEqual({ Blocks: offer.loan_expiration_time })
    expect(request.params.fee_rate_sat_kvb).toBe(FEE_RATE_SAT_KVB)
    expect(request.params.inputs.map((input) => input.sequence)).toEqual([
      0xffff_fffe, 0xffff_fffe, 0xffff_fffe, 0xffff_fffe, 0xffff_fffe,
    ])
  })
})
