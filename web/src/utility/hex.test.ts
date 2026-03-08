import { describe, expect, it } from 'vitest'

import {
  assetIdDisplayToInternal,
  buildBorrowerOutputScriptMetadataScript,
  buildOfferMetadataScript,
  bytesToHex,
  parseOfferMetadataOutputs,
} from './hex'

describe('offer metadata', () => {
  it('parses legacy 64-byte metadata', () => {
    const scriptHex = `6a40${'11'.repeat(32)}${'22'.repeat(32)}`

    expect(parseOfferMetadataOutputs(scriptHex)).toEqual({
      borrowerPubKey: Uint8Array.from({ length: 32 }, () => 0x11),
      principalAssetId: Uint8Array.from({ length: 32 }, () => 0x22),
    })
  })

  it('builds primary and secondary metadata outputs with the borrower output script', () => {
    const signingXOnlyPubkey = '11'.repeat(32)
    const principalAssetId = '0123456789abcdef'.repeat(4)
    const borrowerOutputScriptPubkeyHex = '0014' + 'ab'.repeat(20)

    const scriptHex = buildOfferMetadataScript(signingXOnlyPubkey, principalAssetId)
    const borrowerOutputMetadataScriptHex =
      buildBorrowerOutputScriptMetadataScript(borrowerOutputScriptPubkeyHex)

    expect(scriptHex.startsWith('6a40')).toBe(true)
    expect(borrowerOutputMetadataScriptHex.startsWith('6a16')).toBe(true)

    const metadata = parseOfferMetadataOutputs(scriptHex, borrowerOutputMetadataScriptHex)

    expect(bytesToHex(metadata.borrowerPubKey)).toBe(signingXOnlyPubkey)
    expect(bytesToHex(metadata.principalAssetId)).toBe(
      bytesToHex(assetIdDisplayToInternal(principalAssetId))
    )
    expect(metadata.borrowerOutputScriptPubkeyHex).toBe(borrowerOutputScriptPubkeyHex)
  })

  it('parses the interim hash-only secondary metadata format', () => {
    const scriptHex = `6a40${'11'.repeat(32)}${'22'.repeat(32)}`
    const borrowerOutputHashMetadataScriptHex = `6a20${'33'.repeat(32)}`

    const metadata = parseOfferMetadataOutputs(scriptHex, borrowerOutputHashMetadataScriptHex)

    expect(bytesToHex(metadata.borrowerOutputScriptHash ?? new Uint8Array())).toBe('33'.repeat(32))
  })
})
