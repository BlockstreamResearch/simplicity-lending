import { readFile } from 'node:fs/promises'

import initLwk from '@lilbonekit/lwk-web'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProtocolActionAccess } from '@/lib/wallet/protocolActions'
import { performProtocolActionLocally } from '@/lib/wallet/protocolActions'
import type { ProtocolActionRequest } from '@/protocol/actionRequest'

/*
 * What this proves is the half of performing an action that only a wallet signing in this page has
 * to do: reading the document's own input rule.
 *
 * Every input a protocol declares is either one the wallet finds itself, named by asset and
 * amount, or one located in the deployment's state by the type the document gives it. The
 * extension does that inside itself. Here it is done in the page, and getting it wrong does not
 * fail loudly — it selects the wrong output and pays the wrong party — so each of the seven
 * actions is checked for exactly which outputs it reaches its builder with.
 *
 * The builders themselves are stood in for. What they do afterwards is unchanged by this work and
 * is covered where it always was; what is new is what they are handed.
 */

const builders = {
  createBorrowerAccount: vi.fn(),
  createOffer: vi.fn(),
  acceptOffer: vi.fn(),
  cancelOffer: vi.fn(),
  claimPrincipal: vi.fn(),
  repayOffer: vi.fn(),
  liquidateOffer: vi.fn(),
  claimLenderVault: vi.fn(),
}

const built = {
  pset: { name: 'an unsigned transaction' },
  finalize: () => ({
    finalizedTx: { toString: () => 'abcdef' },
    summary: {
      assetIds: { borrowerNftAssetId: 'borrower-nft' },
      issuedAssetId: 'the-factory-asset',
    },
  }),
}

vi.mock('@/protocol/actions/createOffer', () => ({
  createOfferBuilder: () => ({ createOffer: builders.createOffer }),
}))
vi.mock('@/protocol/actions/createFactory', () => ({
  createFactoryBuilder: () => ({ createBorrowerAccount: builders.createBorrowerAccount }),
}))
vi.mock('@/protocol/actions/acceptOffer', () => ({
  acceptOfferBuilder: () => ({ acceptOffer: builders.acceptOffer }),
}))
vi.mock('@/protocol/actions/cancelOffer', () => ({
  cancelOfferBuilder: () => ({ cancelOffer: builders.cancelOffer }),
}))
vi.mock('@/protocol/actions/claimPrincipal', () => ({
  claimPrincipalBuilder: () => ({ claimPrincipal: builders.claimPrincipal }),
}))
vi.mock('@/protocol/actions/repayOffer', () => ({
  repayOfferBuilder: () => ({ repayOffer: builders.repayOffer }),
}))
vi.mock('@/protocol/actions/liquidateOffer', () => ({
  liquidateOfferBuilder: () => ({ liquidateOffer: builders.liquidateOffer }),
}))
vi.mock('@/protocol/actions/lenderVaultClaim', () => ({
  lenderVaultClaimBuilder: () => ({ claimLenderVault: builders.claimLenderVault }),
}))

vi.mock('@/api/esplora/fee', () => ({
  fetchFeeRateSatPerKvbAbovePending: () => Promise.resolve(1000),
}))

const broadcast = vi.fn((hex: string) => Promise.resolve(`the-txid-for-${hex}`))

vi.mock('@/api/esplora/methods', () => ({ broadcastTx: (hex: string) => broadcast(hex) }))

/** The acceptance that created the active offer, whose first input is the pending offer. */
vi.mock('@/lwk/transaction', () => ({
  fetchTransaction: () =>
    Promise.resolve({
      inputs: [{ outpoint: () => ({ txid: () => ({ toString: () => 'creating-tx' }) }) }],
    }),
}))

beforeAll(async () => {
  const wasm = await readFile('node_modules/@lilbonekit/lwk-web/lwk_wasm_bg.wasm')

  await initLwk({ module_or_path: wasm })
})

/** A real txid, because an outpoint the chain library parses is one this walks back from. */
const ACTIVE_TXID = '11'.repeat(32)

const LBTC = 'ffff'.repeat(16)
const COLLATERAL = LBTC
const PRINCIPAL = 'aaaa'.repeat(16)
const BORROWER_NFT = 'bbbb'.repeat(16)
const LENDER_NFT = 'cccc'.repeat(16)
const FACTORY = 'dddd'.repeat(16)
const FEE_KEEPER = 'eeee'.repeat(16)

/**
 * One output the account holds.
 *
 * Only what selection reads of it — the asset, the amount, where it is and whether it has
 * confirmed. The chain library's own objects come from a scan, and standing them in here is what
 * lets the input rule be checked without one.
 */
function utxo(assetId: string, value: bigint, txid: string, vout: number, confirmed = true) {
  return {
    unblinded: () => ({ asset: () => ({ toString: () => assetId }), value: () => value }),
    outpoint: () => ({ txid: () => ({ toString: () => txid }), vout: () => vout }),
    height: () => (confirmed ? 1 : undefined),
  }
}

/*
 * An account whose outputs make the amounts matter.
 *
 * The principal is split either side of the debt: 250,000 is covered by one output and 262,500 —
 * the principal with its interest — is not. An account holding one large output would answer both
 * questions the same way, and a resolution that asked the wrong one would pass unnoticed.
 */
const HELD = [
  utxo(LBTC, 500_000n, 'lbtc-big', 0),
  utxo(LBTC, 50_000n, 'lbtc-second', 0),
  utxo(LBTC, 400n, 'lbtc-dust', 1),
  utxo(PRINCIPAL, 255_000n, 'principal-a', 0),
  utxo(PRINCIPAL, 20_000n, 'principal-b', 0),
  utxo(BORROWER_NFT, 1n, 'borrower-nft', 0),
  utxo(LENDER_NFT, 1n, 'lender-nft', 0),
  utxo(FACTORY, 1n, 'factory-auth', 0),
]

let synced = 0

function access(held: readonly unknown[] = HELD): ProtocolActionAccess {
  return {
    lwkNetwork: { policyAsset: () => ({ toString: () => LBTC }) } as never,
    processingTxids: [],
    getWollet: () => Promise.resolve({} as never),
    getBlindedWalletUtxos: () => Promise.resolve(held as never),
    getReceiveAddress: () => Promise.resolve('tex1qreceive'),
    syncWallet: () => {
      synced += 1

      return Promise.resolve()
    },
    signPset: pset => Promise.resolve(pset),
    applyBroadcastTransaction: () => {},
  }
}

const DEPLOYMENT: Record<string, string> = {
  BORROWER_NFT_ASSET_ID: BORROWER_NFT,
  COLLATERAL_AMOUNT: '100000',
  COLLATERAL_ASSET_ID: COLLATERAL,
  FACTORY_ASSET_ID: FACTORY,
  LENDER_NFT_ASSET_ID: LENDER_NFT,
  LOAN_EXPIRATION_TIME: '4000',
  PRINCIPAL_AMOUNT: '250000',
  PRINCIPAL_ASSET_ID: PRINCIPAL,
  PRINCIPAL_INTEREST_RATE: '500',
  PROTOCOL_FEE_KEEPER_ASSET_ID: FEE_KEEPER,
}

function request(
  action: string,
  utxos: { txid: string; utxo_type: string; vout: number }[],
  carry: 'instance' | 'params' = 'instance',
  overrides: Record<string, string> = {},
): ProtocolActionRequest {
  const fields = { ...DEPLOYMENT, ...overrides }

  return {
    action,
    broadcast: true,
    contractSources: {},
    manifest: {},
    params: carry === 'params' ? fields : {},
    instance: carry === 'instance' ? { instance: { fields } } : undefined,
    state: { utxos },
  }
}

beforeEach(() => {
  synced = 0
  broadcast.mockClear()
  for (const builder of Object.values(builders)) {
    builder.mockClear()
    builder.mockResolvedValue(built)
  }
})

describe('performing a protocol action with a key this page holds', () => {
  it('creates an offer from the factory the deployment names and the account’s own collateral', async () => {
    await performProtocolActionLocally(
      access(),
      request(
        'CreateOffer',
        [{ txid: 'factory', utxo_type: 'issuance_factory', vout: 1 }],
        'params',
      ),
    )

    expect(builders.createOffer).toHaveBeenCalledWith(
      expect.objectContaining({
        factoryAuthOutpoint: 'factory-auth:0',
        issuanceFactoryOutpoint: 'factory:1',
        // 100,000 of collateral and the fee reserve, out of the account's own L-BTC.
        collateralOutpoints: ['lbtc-big:0'],
        collateralAmount: 100_000n,
        // The height the deployment states, not a term counted from a tip this page read.
        loanExpirationTime: 4000,
      }),
    )
  })

  it('creates the borrower account every other action presupposes, reading nothing', async () => {
    // No deployment to read and no covenant to spend: there is no factory yet, which is the whole
    // point of the action. The builder picks the output that funds the issuance itself.
    const answer = await performProtocolActionLocally(access(), {
      action: 'CreateFactory',
      broadcast: true,
      contractSources: {},
      manifest: {},
      params: {},
      state: { utxos: [] },
    })

    expect(builders.createBorrowerAccount).toHaveBeenCalled()
    // What creating a factory establishes, and the only thing nothing else could work out after.
    expect(answer.deployment).toEqual({ FACTORY_ASSET_ID: 'the-factory-asset' })
  })

  it('accepts an offer against the covenant the deployment holds, with the principal it asks for', async () => {
    await performProtocolActionLocally(
      access(),
      request('AcceptOffer', [
        { txid: 'pending', utxo_type: 'lending_collateral', vout: 0 },
        { txid: 'lender-nft-covenant', utxo_type: 'lender_nft_script_auth', vout: 3 },
      ]),
    )

    expect(builders.acceptOffer).toHaveBeenCalledWith({
      pendingOfferOutpoint: 'pending:0',
      lenderNftOutpoint: 'lender-nft-covenant:3',
      // Read for the borrower NFT's asset id alone, at the output the creating transaction puts
      // it at — which is the transaction the pending offer came from.
      borrowerNftReferenceOutpoint: 'pending:2',
      principalOutpoints: ['principal-a:0'],
      feeOutpoints: ['lbtc-big:0'],
    })
  })

  it('cancels an offer with the borrower NFT the account holds, returning the collateral to it', async () => {
    await performProtocolActionLocally(
      access(),
      request('CancelOffer', [
        { txid: 'pending', utxo_type: 'lending_collateral', vout: 0 },
        { txid: 'lender-nft-covenant', utxo_type: 'lender_nft_script_auth', vout: 3 },
      ]),
    )

    expect(builders.cancelOffer).toHaveBeenCalledWith({
      pendingOfferOutpoint: 'pending:0',
      lenderNftOutpoint: 'lender-nft-covenant:3',
      borrowerNftOutpoint: 'borrower-nft:0',
      collateralRecipientAddress: 'tex1qreceive',
      feeOutpoints: ['lbtc-big:0'],
    })
  })

  it('claims the principal from the covenant holding it', async () => {
    await performProtocolActionLocally(
      access(),
      request('ClaimPrincipal', [
        { txid: 'principal-cov', utxo_type: 'principal_asset_auth', vout: 1 },
      ]),
    )

    expect(builders.claimPrincipal).toHaveBeenCalledWith({
      principalOutpoint: 'principal-cov:1',
      borrowerNftOutpoint: 'borrower-nft:0',
      feeOutpoints: ['lbtc-big:0'],
    })
  })

  it('repays with enough for the principal and its interest, not the principal alone', async () => {
    await performProtocolActionLocally(
      access(),
      request('RepayLoan', [
        { txid: ACTIVE_TXID, utxo_type: 'lending_collateral_active', vout: 0 },
      ]),
    )

    expect(builders.repayOffer).toHaveBeenCalledWith({
      activeOfferOutpoint: `${ACTIVE_TXID}:0`,
      borrowerNftOutpoint: 'borrower-nft:0',
      // The debt is 262,500 — the principal and its interest — so one 255,000 output is not
      // enough. Selecting for the principal alone would take only the first of these.
      principalOutpoints: ['principal-a:0', 'principal-b:0'],
      feeOutpoints: ['lbtc-big:0'],
    })
  })

  it('liquidates against the transaction that created the deployment, walked back to', async () => {
    await performProtocolActionLocally(
      access(),
      request('LiquidateOffer', [
        { txid: ACTIVE_TXID, utxo_type: 'lending_collateral_active', vout: 0 },
      ]),
    )

    expect(builders.liquidateOffer).toHaveBeenCalledWith({
      activeOfferOutpoint: `${ACTIVE_TXID}:0`,
      createOfferTxid: 'creating-tx',
      lenderNftOutpoint: 'lender-nft:0',
      feeOutpoints: ['lbtc-big:0'],
    })
  })

  it('collects the lender’s settlement from the vault the repayment left', async () => {
    await performProtocolActionLocally(
      access(),
      request('ClaimLenderVault', [
        { txid: 'vault', utxo_type: 'lender_vault_finalized', vout: 0 },
      ]),
    )

    expect(builders.claimLenderVault).toHaveBeenCalledWith({
      lenderVaultOutpoint: 'vault:0',
      lenderNftOutpoint: 'lender-nft:0',
      feeOutpoints: ['lbtc-big:0'],
    })
  })

  it('rereads the chain before choosing which outputs to spend', async () => {
    await performProtocolActionLocally(
      access(),
      request('ClaimPrincipal', [
        { txid: 'principal-cov', utxo_type: 'principal_asset_auth', vout: 1 },
      ]),
    )

    expect(synced).toBe(1)
  })

  it('sends what it signed and answers with the transaction id', async () => {
    const result = await performProtocolActionLocally(
      access(),
      request('ClaimPrincipal', [
        { txid: 'principal-cov', utxo_type: 'principal_asset_auth', vout: 1 },
      ]),
    )

    expect(broadcast).toHaveBeenCalledWith('abcdef')
    expect(result.txid).toBe('the-txid-for-abcdef')
  })

  it('reports the deployment an offer creation made, and none for an action that makes none', async () => {
    const created = await performProtocolActionLocally(
      access(),
      request(
        'CreateOffer',
        [{ txid: 'factory', utxo_type: 'issuance_factory', vout: 1 }],
        'params',
      ),
    )

    expect(created.deployment).toMatchObject({ BORROWER_NFT_ASSET_ID: 'borrower-nft' })

    const claimed = await performProtocolActionLocally(
      access(),
      request('ClaimPrincipal', [
        { txid: 'principal-cov', utxo_type: 'principal_asset_auth', vout: 1 },
      ]),
    )

    expect(claimed.deployment).toBeNull()
  })

  it('refuses when no output can pay the fee, rather than building something unpayable', async () => {
    // Dust only. The budget is worked out from what this transaction weighs, so a selection that
    // ignored it would take one of these and build a transaction nothing could confirm.
    const dustOnly = HELD.filter(held => !held.outpoint().txid().toString().startsWith('lbtc-'))

    await expect(
      performProtocolActionLocally(
        access([...dustOnly, utxo(LBTC, 400n, 'lbtc-dust', 1)]),
        request('ClaimPrincipal', [
          { txid: 'principal-cov', utxo_type: 'principal_asset_auth', vout: 1 },
        ]),
      ),
    ).rejects.toThrow(/Insufficient confirmed L-BTC balance/)
  })

  it('never offers one output as both what an action moves and what pays for it', async () => {
    // A deployment whose principal is the policy asset: the same output answers both descriptions,
    // and offered twice it is one output spent twice, which the builder refuses outright.
    await performProtocolActionLocally(
      access(),
      request(
        'AcceptOffer',
        [
          { txid: 'pending', utxo_type: 'lending_collateral', vout: 0 },
          { txid: 'lender-nft-covenant', utxo_type: 'lender_nft_script_auth', vout: 3 },
        ],
        'instance',
        { PRINCIPAL_ASSET_ID: LBTC },
      ),
    )

    const handed = builders.acceptOffer.mock.calls[0]![0] as {
      principalOutpoints: string[]
      feeOutpoints: string[]
    }

    expect(handed.principalOutpoints).toEqual(['lbtc-big:0'])
    expect(handed.feeOutpoints).toEqual(['lbtc-second:0'])
  })

  it('refuses a deployment holding two outputs of the type one input names', async () => {
    await expect(
      performProtocolActionLocally(
        access(),
        request('ClaimPrincipal', [
          { txid: 'principal-cov', utxo_type: 'principal_asset_auth', vout: 1 },
          { txid: 'other-cov', utxo_type: 'principal_asset_auth', vout: 0 },
        ]),
      ),
    ).rejects.toThrow(/reports 2 principal_asset_auth outputs/)
  })

  it('refuses an action this page cannot perform, rather than sending something else', async () => {
    await expect(performProtocolActionLocally(access(), request('BurnItAll', []))).rejects.toThrow(
      /cannot perform BurnItAll/,
    )
  })
})
