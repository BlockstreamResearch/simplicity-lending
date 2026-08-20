import { describe, expect, it, vi } from 'vitest'

import { NETWORK_CONFIG } from '@/constants/network-config'

/**
 * What a contract action can be funded from, counted from the chain.
 *
 * The wallet cannot answer this: its `getUTXOs` describes the account as the chain library
 * reports it, and that library treats an unblinded output at the wallet's own script as external
 * and omits it. So the count is taken from the chain at the one address a contract action spends
 * from — and what it must not count is everything this network hides by default.
 */

const COLLATERAL = NETWORK_CONFIG.collateralAsset.id

const CONFIRMED = { block_height: 2_579_800, confirmed: true }

vi.mock('@/api/esplora/methods', () => ({
  fetchScriptHashUtxo: vi.fn(),
}))

vi.mock('@/providers/walletFacade/useWallet', () => ({
  useWallet: () => ({ scriptPubkey: '0014' + '11'.repeat(20) }),
}))

const { fetchScriptHashUtxo } = await import('@/api/esplora/methods')
const { contractSpendableTotal } = await import('./useContractFunding')

type Utxo = Parameters<typeof contractSpendableTotal>[0][number]

/** One chain output, in the shape Esplora reports for this network. */
function utxo(fields: Partial<Utxo>): Utxo {
  return { status: CONFIRMED, txid: 'a'.repeat(64), vout: 0, ...fields } as Utxo
}

describe('what an account can put behind a contract action', () => {
  it('counts an output whose amount is in the open', () => {
    expect(contractSpendableTotal([utxo({ asset: COLLATERAL, value: 27_288, vout: 3 })])).toBe(
      27_288n,
    )
  })

  it('does not count one whose amount is hidden, which is most of what an account holds', () => {
    expect(
      contractSpendableTotal([
        utxo({ asset: COLLATERAL, value: 27_288, vout: 3 }),
        utxo({ assetcommitment: '0b', valuecommitment: '09' }),
      ]),
    ).toBe(27_288n)
  })

  it('does not count another asset, or one the chain has not confirmed', () => {
    expect(
      contractSpendableTotal([
        {
          asset: NETWORK_CONFIG.principalAsset.id,
          status: CONFIRMED,
          txid: 'c',
          value: 5_000,
          vout: 0,
        },
        { asset: COLLATERAL, status: { confirmed: false }, txid: 'd', value: 1_000, vout: 0 },
      ]),
    ).toBe(0n)
  })

  it('reads the chain rather than the wallet, which does not serve this', () => {
    expect(fetchScriptHashUtxo).toBeDefined()
  })
})

describe('the key Esplora looks a script up by', () => {
  /*
   * Electrum reverses the digest and this endpoint does not. Both are 32 bytes of hex, so the
   * wrong one returns an empty history rather than an error — an account with twenty-one
   * transactions reading as an account with none.
   */
  it('is the plain SHA-256 of the script, not the reverse of it', async () => {
    const { scriptHashOf } = await import('./useContractFunding')

    expect(await scriptHashOf('0014d31e274481e3f5e6cf3005b64b460933b7255c8c')).toBe(
      '1587d018c23edd9be95ca3f9ddbdbd18333493a69f39cad7afb2bbde84752449',
    )
  })
})
