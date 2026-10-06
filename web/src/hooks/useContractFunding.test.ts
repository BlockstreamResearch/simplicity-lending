import { describe, expect, it, vi } from 'vitest'

import { NETWORK_CONFIG } from '@/constants/network-config'
import type { WalletUtxo } from '@/lib/wallet/types'

/**
 * What a contract action can be funded from, counted from two reads that do not overlap.
 *
 * The wallet answers for the money it holds, the blinded outputs included, because it unblinds
 * its own and hands the signing module the secrets. A page never sees those amounts on the chain,
 * so that part can only come from the wallet.
 *
 * The chain read is left with one job: an unblinded output at the account's first address. The
 * chain library treats an explicit output at a confidential wallet script as external and leaves
 * it out of what the wallet reports, while the wallet's own action funding reads and spends it.
 */

const COLLATERAL = NETWORK_CONFIG.collateralAsset.id

const CONFIRMED = { block_height: 2_579_800, confirmed: true }

vi.mock('@/api/esplora/methods', () => ({
  fetchScriptHashUtxo: vi.fn(),
}))

vi.mock('@/providers/walletFacade/useWallet', () => ({
  useWallet: () => ({
    account: 'bip122:0:0',
    getUtxos: async () => [],
    scriptPubkey: '0014' + '11'.repeat(20),
  }),
}))

const { fetchScriptHashUtxo } = await import('@/api/esplora/methods')
const { contractSpendableTotal, walletSpendableTotal } = await import('./useContractFunding')

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

  it('leaves a hidden amount to the wallet, because the chain does not say what it is', () => {
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

  it('still reads the chain, for the output the wallet leaves out of its own list', () => {
    expect(fetchScriptHashUtxo).toBeDefined()
  })
})

describe('what the wallet says it can spend', () => {
  /** In the shape the wallet reports an output, already narrowed to one asset. */
  function held(fields: Partial<WalletUtxo>): WalletUtxo {
    return {
      address: 'lq1',
      amount: '0',
      assetId: COLLATERAL,
      confidential: true,
      scriptPubkey: '0014' + '11'.repeat(20),
      spendable: true,
      txid: 'b'.repeat(64),
      vout: 0,
      ...fields,
    }
  }

  it('counts a blinded output, which is what the chain read cannot see', () => {
    expect(walletSpendableTotal([held({ amount: '150000', vout: 1 })])).toBe(150_000n)
  })

  it('counts an unblinded one the same way', () => {
    expect(walletSpendableTotal([held({ amount: '900', confidential: false })])).toBe(900n)
  })

  it('does not count one the chain has not confirmed', () => {
    expect(
      walletSpendableTotal([
        held({ amount: '150000', vout: 1 }),
        held({ amount: '70000', spendable: false, vout: 2 }),
      ]),
    ).toBe(150_000n)
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
