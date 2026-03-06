/**
 * Simplicity covenant sources.
 * Loaded at build time from paths in web/simplicity-covenants.config.json:
 * - p2pk: only covenant that lives in web (sources/p2pk.simf).
 * - pre_lock, lending, asset_auth, script_auth: read directly from crates/contracts.
 */

import { sources } from 'virtual:simplicity-sources'

export type SimplicityCovenantId = keyof typeof sources

export function getSource(id: SimplicityCovenantId): string {
  const src = sources[id]
  if (!src) throw new Error(`Unknown Simplicity covenant: ${id}`)
  return src
}

export function listCovenantIds(): SimplicityCovenantId[] {
  return Object.keys(sources) as SimplicityCovenantId[]
}
