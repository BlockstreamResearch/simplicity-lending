import { sources } from 'virtual:simplicity-sources'

import manifest from './lending_v3.manifest.json'

/**
 * The lending protocol as this deployment runs it: one document plus the contract
 * sources it references, under the exact filenames the document uses.
 *
 * The document is deployment-specific — it names this deployment's factory
 * parameters, its protocol-fee keeper and the program-id tags its indexer keys
 * offer detection on. It belongs here rather than in a wallet: a wallet that
 * carried it would know about this protocol, and it is meant to know only how to
 * read documents like it.
 *
 * The sources come from `crates/contracts/simf/` through the build's virtual
 * module, so there is one copy of each contract in this repository and the
 * document and the code it describes cannot drift apart.
 */
export const LENDING_PROTOCOL = Object.freeze({
  manifest,
  sources: Object.freeze({
    'lending.simf': sources.lending,
    'asset_auth.simf': sources.asset_auth,
    'asset_auth_vault.simf': sources.asset_auth_vault,
    'script_auth.simf': sources.script_auth,
    'issuance_factory.simf': sources.issuance_factory,
  }),
})

export type LendingProtocol = typeof LENDING_PROTOCOL
