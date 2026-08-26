import { readFile } from 'node:fs/promises'

import initLwk, { Mnemonic, Network, Signer } from '@lilbonekit/lwk-web'
import { beforeAll, describe, expect, it } from 'vitest'

import { scriptPubkeyFromDescriptor, withoutBlindingKey } from '@/lib/wallet/lwk'

/*
 * The real chain library, not a stand-in.
 *
 * Every other wallet-facing test mocks this module, saying "this is not a browser" — and for a
 * page that scans a chain that is true. This one is about what the library accepts, so mocking it
 * would prove nothing at all: the failure it is here to stop was the library refusing a descriptor
 * that a mock returning a string would have accepted happily.
 *
 * The module is a WebAssembly build whose own loader fetches its `.wasm` by URL, which there is
 * nothing to serve here. It is handed the bytes instead, before anything under test runs; the
 * loader inside `lwk.ts` then finds the module already started and reuses it.
 */
beforeAll(async () => {
  const wasm = await readFile('node_modules/@lilbonekit/lwk-web/lwk_wasm_bg.wasm')

  await initLwk({ module_or_path: wasm })
})

/** What a signing connector hands over: confidential already, carrying its own blinding key. */
function seedDescriptor(): string {
  const mnemonic = new Mnemonic(
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  )
  const signer = new Signer(mnemonic, Network.testnet())

  return signer.wpkhSlip77Descriptor().toString()
}

/** What the HUMID extension hands over: bare, with no blinding key in it at all. */
const EXTENSION_DESCRIPTOR =
  'elwpkh([73c5da0a/84h/1h/0h]tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/<0;1>/*)'

/** The script that key material's first address pays to, on Liquid testnet. */
const FIRST_SCRIPT = '0014d0c4a3ef09e997b6e99e397e518fe3e41a118ca1'

describe('the script an approved descriptor hands out', () => {
  it('reads a confidential descriptor as it stands, which is what a connector serves', async () => {
    await expect(scriptPubkeyFromDescriptor(seedDescriptor())).resolves.toBe(FIRST_SCRIPT)
  })

  it('reads a bare descriptor by adding a blinding key, which is what the extension serves', async () => {
    await expect(scriptPubkeyFromDescriptor(EXTENSION_DESCRIPTOR)).resolves.toBe(FIRST_SCRIPT)
  })

  it('derives the same script from either, because a script does not depend on the blinding key', async () => {
    const fromConnector = await scriptPubkeyFromDescriptor(seedDescriptor())
    const fromExtension = await scriptPubkeyFromDescriptor(EXTENSION_DESCRIPTOR)

    expect(fromConnector).toBe(fromExtension)
  })

  it('keeps the checksum a wallet attaches from being read as the wrapper’s own', async () => {
    const checksummed = seedDescriptor()

    expect(checksummed).toContain('#')
    await expect(scriptPubkeyFromDescriptor(checksummed)).resolves.toBe(FIRST_SCRIPT)
  })

  it('derives the same script once the account’s blinding key is taken out of the descriptor', async () => {
    const real = seedDescriptor()
    const published = withoutBlindingKey(real)

    expect(published).not.toContain(/slip77\(([0-9a-f]{64})\)/u.exec(real)![1]!)
    await expect(scriptPubkeyFromDescriptor(published)).resolves.toBe(FIRST_SCRIPT)
  })

  it('leaves a descriptor that carries no blinding key exactly as it is', () => {
    expect(withoutBlindingKey(EXTENSION_DESCRIPTOR)).toBe(EXTENSION_DESCRIPTOR)
  })

  it('takes the key out of every confidential form the chain library accepts, not only slip77', () => {
    const real = seedDescriptor().split('#')[0]!
    const key = /slip77\(([0-9a-f]{64})\)/u.exec(real)![1]!
    const account = real.replace(/^ct\(slip77\([0-9a-f]+\),/u, '').replace(/\)$/u, '')

    // Each of these is a descriptor LWK parses, and each carries the key that unblinds this
    // account. A stripper that knew only the first would publish the other two intact.
    for (const form of [
      `ct(slip77(${key}),${account})`,
      `ct(${key},${account})`,
      `ct(slip77(${key.toUpperCase()}),${account})`,
    ]) {
      expect(withoutBlindingKey(form)).not.toContain(key)
      expect(withoutBlindingKey(form)).not.toContain(key.toUpperCase())
    }
  })

  it('refuses a confidential descriptor it cannot take the key out of, rather than passing it on', () => {
    // A shape it does not recognise is not a shape it may hand on: a key published with nothing to
    // show it happened is the failure this exists to stop.
    expect(() => withoutBlindingKey('elip151(elwpkh(tpub/<0;1>/*))')).toThrow(
      /could not be taken out/u,
    )
  })

  it('says a descriptor could be read neither way, rather than failing as a bad wrapping', async () => {
    await expect(scriptPubkeyFromDescriptor('not a descriptor')).rejects.toThrow(
      /neither as it stands nor with a blinding key added/,
    )
  })
})
