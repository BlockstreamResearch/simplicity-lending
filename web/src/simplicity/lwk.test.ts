import { describe, expect, it } from 'vitest'
import { buildP2pkArguments } from './covenants'
import { createP2trAddress, getLwk, getSource } from './index'
import { getScriptPubkeyHexFromAddress } from '../utility/addressP2pk'
import {
  getTaprootUnspendableInternalKey,
  TAPROOT_UNSPENDABLE_INTERNAL_KEY_BYTES,
} from '../utility/taprootUnspendableKey'
import { bytesToHex } from '../utility/hex'

describe('createP2trAddress', () => {
  it('loads a Simplicity program before deriving an address', async () => {
    const lwk = await getLwk()
    const internalKey = getTaprootUnspendableInternalKey(lwk)
    const address = await createP2trAddress({
      source: getSource('p2pk'),
      args: buildP2pkArguments(lwk, {
        publicKeyHex: bytesToHex(TAPROOT_UNSPENDABLE_INTERNAL_KEY_BYTES),
      }),
      internalKey,
      network: 'testnet',
    })

    expect(await getScriptPubkeyHexFromAddress(address)).toHaveLength(68)
  })
})
