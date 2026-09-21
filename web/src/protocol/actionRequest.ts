/**
 * One protocol action, in the shape the wallet takes it.
 *
 * The wallet is given the document, the sources of the contracts it references, the action and
 * whatever parameters a person chose. It compiles each contract, derives the address the funds
 * would sit at, finds the money, places the inputs and outputs where the document says, signs
 * and sends. None of that happens here, and nothing here builds a transaction.
 */

/** A protocol as this dapp carries it: one document, and its contracts keyed by file name. */
export interface CarriedProtocol {
  manifest: object
  sources: Record<string, string>
}

/**
 * A deployment's own field values, as the wallet reads them.
 *
 * Written once, by the action that creates the deployment, and read by every action after it.
 * A site that did not create one carries what the deployment was recorded with — the assets,
 * the amounts, the rate, the expiration — and never the covenant script hashes, which are the
 * output of a compiler. The wallet works those out from these, using the description the
 * document's own constructor carries.
 */
export interface ProtocolInstance {
  fields: Record<string, string>
}

/** One covenant output the deployment holds, as the wallet locates it. */
export interface ProtocolStateUtxo {
  txid: string
  utxo_type: string
  vout: number
}

/** The deployment's live covenant outputs, which is how an action reaches what it spends. */
export interface ProtocolState {
  utxos: ProtocolStateUtxo[]
}

/** The request the wallet is asked with. Its parts are the accepted request contract's. */
export interface ProtocolActionRequest extends Record<string, unknown> {
  action: string
  broadcast: boolean
  contractSources: Record<string, string>
  instance?: { instance: ProtocolInstance }
  manifest: object
  params: Record<string, unknown>
  state?: ProtocolState
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/** Every action the document declares, whichever contract it is bound to. */
function declaredActions(manifest: object): Set<string> {
  const document = asRecord(manifest) ?? {}
  const names = new Set(Object.keys(asRecord(document.actions) ?? {}))

  for (const template of Object.values(asRecord(document.contract_templates) ?? {})) {
    for (const name of Object.keys(asRecord(asRecord(template)?.actions) ?? {})) {
      names.add(name)
    }
  }

  return names
}

/**
 * The contracts this document references, keyed by the path it references them by.
 *
 * The path is taken from the document rather than written down beside the sources: it is what
 * the wallet looks the source up under, so a key agreed anywhere else is a key that can drift.
 * This document writes every one of them relative — `./lending.simf` — and a source filed under
 * the bare file name reaches the wallet as a source it was never given.
 */
function contractSources(protocol: CarriedProtocol): Record<string, string> {
  const utxoTypes = asRecord(asRecord(protocol.manifest)?.utxo_types) ?? {}
  const sources: Record<string, string> = {}

  for (const declared of Object.values(utxoTypes)) {
    const path = asRecord(asRecord(declared)?.script)?.source

    if (typeof path !== 'string' || path in sources) continue

    const source = protocol.sources[path.replace(/^\.\//u, '')]

    if (source === undefined) {
      throw new Error(`This dapp carries no source for ${path}, which its protocol references.`)
    }

    sources[path] = source
  }

  return sources
}

/**
 * Builds the request for one action.
 *
 * Parameters are only what a person chose. A parameter the document states a default for is
 * left out, because the deployment is what answers for it — filling it in from here would put
 * this dapp's copy of a value where the document's own belongs.
 */
export function protocolActionRequest(
  protocol: CarriedProtocol,
  chosen: {
    action: string
    instance?: Record<string, string>
    params?: Record<string, unknown>
    state?: ProtocolState
  },
): ProtocolActionRequest {
  if (!declaredActions(protocol.manifest).has(chosen.action)) {
    throw new Error(`This protocol declares no action named ${chosen.action}.`)
  }

  return {
    action: chosen.action,
    broadcast: true,
    contractSources: contractSources(protocol),
    manifest: protocol.manifest,
    params: chosen.params ?? {},
    // Only where the action reads one. An action that creates the deployment computes every
    // field of it, so sending one there would put this dapp's copy of a value where the
    // document's own belongs.
    ...(chosen.instance ? { instance: { instance: { fields: chosen.instance } } } : {}),
    // Only where the action spends one. An action that creates rather than spends has nothing
    // to locate, and the wallet reads the request's shape as what the action needs.
    ...(chosen.state ? { state: chosen.state } : {}),
  }
}
