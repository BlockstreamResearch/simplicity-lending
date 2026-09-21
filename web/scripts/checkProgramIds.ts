/* eslint-disable no-console */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The protocol document declares a program-id tag for each covenant it identifies
 * on chain, and states how it is derived: the first four bytes of the SHA-256 of
 * the LF-normalised contract source. The indexer keys offer detection on those
 * tags, and the covenant address is derived from the same source.
 *
 * So a document paired with the wrong sources points at covenants that are not
 * where it says they are, and nothing at runtime would say so — the failure is a
 * transaction nobody can spend. This recomputes both tags from the sources this
 * repository actually holds and fails when either disagrees.
 *
 * The `.trim()` matches the build's own loader, which is what makes this check
 * about the same bytes the application compiles.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

interface CovenantConfig {
  covenants: Array<{ id: string; path: string }>
}

interface ProgramIdParam {
  default?: unknown
}

const readJson = <T>(filePath: string): T => JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T

const programIdTag = (source: string): string =>
  createHash('sha256').update(source.replace(/\r\n/g, '\n').trim()).digest('hex').slice(0, 8)

const declaredProgramIds = (document: unknown): Map<string, string> => {
  const declared = new Map<string, string>()

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }

    if (typeof node !== 'object' || node === null) return

    for (const [key, value] of Object.entries(node)) {
      if (key.endsWith('PROGRAM_ID')) {
        const declaredDefault = (value as ProgramIdParam)?.default
        if (typeof declaredDefault === 'string') declared.set(key, declaredDefault)
      }
      visit(value)
    }
  }

  visit(document)

  return declared
}

// Which contract each declared tag is derived from. The document names the
// contracts by file; this says which parameter identifies which one.
const PROGRAM_ID_SOURCES: Record<string, string> = {
  LENDING_PROGRAM_ID: 'lending',
  FACTORY_PROGRAM_ID: 'issuance_factory',
}

const config = readJson<CovenantConfig>(path.join(root, 'simplicity-covenants.config.json'))
const document = readJson<unknown>(path.join(root, 'src/protocol/lending_v3.manifest.json'))

const derived = new Map(
  config.covenants.map(covenant => [
    covenant.id,
    programIdTag(fs.readFileSync(path.resolve(root, covenant.path), 'utf-8')),
  ]),
)

const declared = declaredProgramIds(document)
const failures: string[] = []

for (const [parameter, declaredTag] of declared) {
  const covenantId = PROGRAM_ID_SOURCES[parameter]

  if (!covenantId) {
    failures.push(
      `${parameter} is declared by the document but this check does not know its contract`,
    )
    continue
  }

  const derivedTag = derived.get(covenantId)

  if (!derivedTag) {
    failures.push(
      `${parameter} derives from ${covenantId}, which the covenant config does not list`,
    )
    continue
  }

  if (derivedTag !== declaredTag) {
    failures.push(
      `${parameter} is declared ${declaredTag} but ${covenantId} derives ${derivedTag} — ` +
        'the document and the contract sources are not a matched pair',
    )
    continue
  }

  console.log(`${parameter} ${declaredTag} matches ${covenantId}`)
}

for (const parameter of Object.keys(PROGRAM_ID_SOURCES)) {
  if (!declared.has(parameter)) {
    failures.push(
      `${parameter} is expected by this check but the document declares no such parameter`,
    )
  }
}

if (failures.length > 0) {
  console.error('\nProtocol document and contract sources disagree:')
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}

console.log(`\n${declared.size} program id(s) match the contract sources in this repository.`)
