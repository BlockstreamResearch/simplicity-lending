import { describe, expect, it } from 'vitest'

import { protocolActionRequest } from './actionRequest'
import manifest from './lending_v3.manifest.json'

/**
 * The request one protocol action is asked for as.
 *
 * The wallet is handed the document and the sources of the contracts it references; it decides
 * everything else for itself. What this has to get right is the joining: a source reaches the
 * wallet under the exact path the document names it by, and a path the document names with no
 * source behind it is refused here rather than half-answered there.
 */

/** Stand-ins for the five contracts. Nothing here compiles them; only their paths are joined. */
const SOURCES = {
  'asset_auth.simf': 'asset_auth source',
  'asset_auth_vault.simf': 'asset_auth_vault source',
  'issuance_factory.simf': 'issuance_factory source',
  'lending.simf': 'lending source',
  'script_auth.simf': 'script_auth source',
}

const PROTOCOL = { manifest, sources: SOURCES }

describe('the request a protocol action is asked for as', () => {
  it('supplies each contract under the path the document names it by', () => {
    const request = protocolActionRequest(PROTOCOL, { action: 'CreateFactory' })

    // Read from the document itself: every `utxo_types.*.script.source` is written relative,
    // and a key without that prefix is a source the wallet reports as not supplied.
    expect(Object.keys(request.contractSources).sort()).toEqual([
      './asset_auth.simf',
      './asset_auth_vault.simf',
      './issuance_factory.simf',
      './lending.simf',
      './script_auth.simf',
    ])
    expect(request.contractSources['./issuance_factory.simf']).toBe('issuance_factory source')
  })

  it('asks for the chosen action, and for the wallet to send what it builds', () => {
    const request = protocolActionRequest(PROTOCOL, { action: 'CreateFactory' })

    expect(request.action).toBe('CreateFactory')
    expect(request.broadcast).toBe(true)
    expect(request.manifest).toBe(manifest)
  })

  it('leaves a parameter the document answers for itself unfilled', () => {
    const request = protocolActionRequest(PROTOCOL, { action: 'CreateFactory' })

    // Creating the factory declares three parameters and states a default for each, so a value
    // sent from here would override what the deployment says about itself.
    expect(request.params).toEqual({})
  })

  it('carries a parameter the person chose', () => {
    const request = protocolActionRequest(PROTOCOL, {
      action: 'CreateOffer',
      params: { COLLATERAL_AMOUNT: '1000' },
    })

    expect(request.params).toEqual({ COLLATERAL_AMOUNT: '1000' })
  })

  it('carries the covenant outputs an action spends, which the document locates by type', () => {
    const request = protocolActionRequest(PROTOCOL, {
      action: 'CreateOffer',
      params: { COLLATERAL_AMOUNT: '1000' },
      state: { utxos: [{ txid: 'a'.repeat(64), utxo_type: 'issuance_factory', vout: 1 }] },
    })

    expect(request.state).toEqual({
      utxos: [{ txid: 'a'.repeat(64), utxo_type: 'issuance_factory', vout: 1 }],
    })
  })

  it('sends no state for an action that spends no covenant', () => {
    expect(protocolActionRequest(PROTOCOL, { action: 'CreateFactory' })).not.toHaveProperty('state')
  })

  it('refuses an action the document does not declare, rather than sending it', () => {
    expect(() => protocolActionRequest(PROTOCOL, { action: 'BorrowEverything' })).toThrow(
      /BorrowEverything/u,
    )
  })

  it('refuses by name when a contract the document references is not carried here', () => {
    const missing = {
      manifest,
      sources: { ...SOURCES, 'issuance_factory.simf': undefined } as unknown as typeof SOURCES,
    }

    expect(() => protocolActionRequest(missing, { action: 'CreateFactory' })).toThrow(
      /issuance_factory\.simf/u,
    )
  })
})
