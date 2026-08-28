import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProtocolBuilderAccess } from '@/lib/wallet/protocolBuilderAccess'

/*
 * What this action asks the chain library to build, watched at that boundary.
 *
 * Everything here is decided before a transaction exists and is invisible afterwards to anything
 * short of a live run: which output funds the issuance, that one unit goes to the account and one
 * to the covenant, that the covenant's is the second output, and what the OP_RETURN records. Each
 * of those can be wrong in a way that still produces a transaction, which is why the chain library
 * is stood in and asked what it was told rather than what came out.
 */

const told: { method: string; args: unknown[] }[] = []
const feeRateAskedWith: unknown[] = []

vi.mock('@/api/esplora/fee', () => ({
  fetchFeeRateSatPerKvbAbovePending: (txids: readonly string[]) => {
    feeRateAskedWith.push(txids)

    return Promise.resolve(4242)
  },
}))

vi.mock('@/simplicity/issuance-factory/program', () => ({
  loadIssuanceFactoryProgram: (params: unknown) => {
    told.push({ method: 'loadIssuanceFactoryProgram', args: [params] })

    return { createP2trAddress: () => ({ toString: () => 'the factory covenant' }) }
  },
}))

vi.mock('@lilbonekit/lwk-web', () => {
  class TxBuilder {
    feeRate(rate: number) {
      told.push({ method: 'feeRate', args: [rate] })

      return this
    }
    setWalletUtxos(outpoints: unknown[]) {
      told.push({ method: 'setWalletUtxos', args: [outpoints] })

      return this
    }
    issueAssetToRecipients(...args: unknown[]) {
      told.push({ method: 'issueAssetToRecipients', args })

      return this
    }
    addPostIssuanceScriptOutput(...args: unknown[]) {
      told.push({ method: 'addPostIssuanceScriptOutput', args })

      return this
    }
    setInputSequence(...args: unknown[]) {
      told.push({ method: 'setInputSequence', args })

      return this
    }
    finish() {
      return { unsigned: true }
    }
  }

  return {
    TxBuilder,
    Address: { parse: (a: string) => ({ toUnconfidential: () => ({ toString: () => a }) }) },
    IssuanceRecipient: {
      fromAddress: (amount: bigint, address: { toString(): string }) => ({
        amount,
        to: address.toString(),
      }),
    },
    Script: { newOpReturn: (bytes: Uint8Array) => ({ bytes: () => bytes }) },
    XOnlyPublicKey: { fromString: () => ({}) },
    assetIdFromIssuance: () => ({ toString: () => 'the issued asset' }),
    // What the asset contract is built and hashed with. The contract itself is the deployment's
    // own description of the asset and is not what this file is about.
    Contract: class {},
    ContractHash: { fromBytes: (bytes: Uint8Array) => ({ length: bytes.length }) },
  }
})

const { createFactoryBuilder } = await import('@/protocol/actions/createFactory')

const POLICY = 'the policy asset'

/** One output the account holds, in the only terms this builder reads it by. */
function utxo(
  txid: string,
  vout: number,
  value: bigint,
  held = { asset: POLICY, confirmed: true },
) {
  return {
    outpoint: () => ({
      txid: () => ({ toString: () => txid }),
      vout: () => vout,
      toString: () => `${txid}:${vout}`,
    }),
    unblinded: () => ({ value: () => value, asset: () => ({ toString: () => held.asset }) }),
    height: () => (held.confirmed ? 1 : undefined),
  }
}

function access(utxos: unknown[], processingTxids: readonly string[] = []): ProtocolBuilderAccess {
  return {
    lwkNetwork: { policyAsset: () => ({ toString: () => POLICY }) } as never,
    processingTxids,
    getWollet: () =>
      Promise.resolve({
        finalize: () => ({ extractTx: () => ({ txid: () => ({ toString: () => 'the txid' }) }) }),
      } as never),
    getBlindedWalletUtxos: () => Promise.resolve(utxos as never),
    getReceiveAddress: () => Promise.resolve('tex1qreceive'),
    syncWallet: () => Promise.resolve(),
  }
}

function toldOf(method: string) {
  return told.filter(call => call.method === method)
}

beforeEach(() => {
  told.length = 0
  feeRateAskedWith.length = 0
})

describe('creating the borrower account every other action presupposes', () => {
  it('funds the issuance from the smallest confirmed L-BTC output that clears the reserve', async () => {
    await createFactoryBuilder(
      access([
        utxo('plenty', 0, 100_000n),
        // Exactly the reserve is not above it, and neither of the next two is spendable here.
        utxo('exactly-the-reserve', 0, 250n),
        utxo('unconfirmed', 0, 251n, { asset: POLICY, confirmed: false }),
        utxo('another-asset', 0, 260n, { asset: 'a token', confirmed: true }),
        utxo('smallest-that-clears-it', 7, 300n),
      ]),
    ).createBorrowerAccount()

    // Taking the largest would lock up more than this transaction needs; taking one at or below
    // the reserve builds a transaction that cannot pay for itself.
    expect(toldOf('setWalletUtxos')[0]!.args[0]).toHaveLength(1)
    expect(String((toldOf('setWalletUtxos')[0]!.args[0] as { toString(): string }[])[0])).toBe(
      'smallest-that-clears-it:7',
    )
  })

  it('issues one unit to the account and one to the covenant, the covenant second', async () => {
    await createFactoryBuilder(access([utxo('funding', 0, 9_000n)])).createBorrowerAccount()

    // The order is the output order, and every later action locates the factory by it: the
    // account's auth NFT at :0, the covenant at :1.
    expect(toldOf('issueAssetToRecipients')[0]!.args[0]).toEqual([
      { amount: 1n, to: 'tex1qreceive' },
      { amount: 1n, to: 'the factory covenant' },
    ])
    // No reissuance token: this asset is minted once and never again.
    expect(toldOf('issueAssetToRecipients')[0]!.args[1]).toBe(0n)
  })

  it('reports where the two outputs landed, and the asset it issued', async () => {
    const built = await createFactoryBuilder(
      access([utxo('funding', 3, 9_000n)]),
    ).createBorrowerAccount()

    const { summary } = built.finalize({} as never)

    expect(summary).toMatchObject({
      fundingOutpoint: 'funding:3',
      factoryAuthOutpoint: 'the txid:0',
      issuanceFactoryOutpoint: 'the txid:1',
      issuedAssetId: 'the issued asset',
      // Where the covenant it just funded lives, and the bytes it recorded — reported as what was
      // built rather than as anything this file made up.
      factoryAddress: 'the factory covenant',
    })
    expect(summary.metadataOpReturnHex).toBe(
      [...(toldOf('addPostIssuanceScriptOutput')[0]!.args[0] as { bytes(): Uint8Array }).bytes()]
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join(''),
    )
  })

  it('records the program it created, so the indexer can recognise the factory', async () => {
    await createFactoryBuilder(access([utxo('funding', 0, 9_000n)])).createBorrowerAccount()

    const metadata = (
      toldOf('addPostIssuanceScriptOutput')[0]!.args[0] as { bytes(): Uint8Array }
    ).bytes()

    expect(metadata).toHaveLength(13)
    // The first four bytes are the program's own id, and the whole reason this output exists: it
    // is what the indexer recognises a factory by. A zeroed one records a factory nobody finds.
    const { sources } = await import('virtual:simplicity-sources')
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(sources.issuance_factory),
    )

    expect([...metadata.slice(0, 4)]).toEqual([...new Uint8Array(digest).slice(0, 4)])
    // The two numbers the covenant was built with, written where the indexer reads them.
    expect(metadata[4]).toBe(2)
    expect(new DataView(metadata.buffer).getBigUint64(5, true)).toBe(0n)
    expect(toldOf('loadIssuanceFactoryProgram')[0]!.args[0]).toEqual({
      issuingUtxosCount: 2,
      reissuanceFlags: 0n,
    })
    // Carried by the policy asset at zero value, as an OP_RETURN is.
    expect(toldOf('addPostIssuanceScriptOutput')[0]!.args[1]).toBe(0n)
    expect(String(toldOf('addPostIssuanceScriptOutput')[0]!.args[2])).toBe(POLICY)
  })

  it('pays a fee that beats what this wallet already has in the mempool', async () => {
    await createFactoryBuilder(
      access([utxo('funding', 0, 9_000n)], ['already-sent']),
    ).createBorrowerAccount()

    expect(feeRateAskedWith).toEqual([['already-sent']])
    expect(toldOf('feeRate')[0]!.args[0]).toBe(4242)
    // The one input it spends is replaceable, so a stuck transaction can be bumped.
    expect(toldOf('setInputSequence')[0]!.args[1]).toBe(0xfffffffd)
  })

  it('says what is missing when nothing confirmed clears the reserve', async () => {
    await expect(
      createFactoryBuilder(
        access([
          utxo('unconfirmed', 0, 1_000_000n, { asset: POLICY, confirmed: false }),
          utxo('at-the-reserve', 0, 250n),
          utxo('another-asset', 0, 1_000_000n, { asset: 'a token', confirmed: true }),
        ]),
      ).createBorrowerAccount(),
    ).rejects.toThrow(/confirmed wallet L-BTC UTXO larger than/u)
  })

  it('says where the account receives is missing, rather than building for nowhere', async () => {
    await expect(
      createFactoryBuilder({
        ...access([utxo('funding', 0, 9_000n)]),
        getReceiveAddress: () => Promise.resolve(null),
      }).createBorrowerAccount(),
    ).rejects.toThrow('Missing receive address')
  })
})
