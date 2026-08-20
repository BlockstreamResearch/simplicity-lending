import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * What the application can reach, read from the imports themselves.
 *
 * A grep says a file exists; this says whether the running application can get to it. The two
 * differ exactly where it matters here — a superseded module is meant to stay on disk and be
 * unreachable, and only a walk from the entry can tell those apart.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENTRY = 'main.tsx'

/** Modules kept for the adapters they will become, which nothing may reach today. */
const SUPERSEDED = [
  'lib/wallet-core/',
  'providers/wallet/',
  'providers/humid/',
  'components/JadeUnlockModal.tsx',
  'components/MnemonicInput.tsx',
  'components/modals/ConnectWalletModal.tsx',
  // Its own account chip, from before the facade existed. The wallet button beside it shows the
  // same account, and two of them in one header is one too many.
  'components/HumidAccountButton.tsx',
  'pages/Demo/WalletDemo.tsx',
  // Creating a borrower account by building the transaction here. The wallet builds it now, from
  // the protocol's own document; what is left on disk is the reading half's starting point.
  'hooks/useBorrowerAccount.ts',
  // Creating an offer the same way, with its developer page: both are written around outpoints
  // this page chose and a wallet object it no longer has.
  'hooks/useCreateOffer.ts',
  'pages/Demo/CreateOfferDemo.tsx',
]

/** The facade. Everything below it may name a wallet; nothing above it may. */
const BELOW_THE_SEAM = ['lib/humid/', 'lib/wallet/', 'api/wallet/', 'providers/walletFacade/']

/** Naming any of these is reaching a wallet rather than asking the facade for one. */
const WALLET_SPECIFIERS = ['@/lib/humid/appkit', '@reown/appkit', '@/lib/wallet/humid/']

const IMPORT_PATTERN = /(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g

function specifiersIn(source: string): string[] {
  return [...source.matchAll(IMPORT_PATTERN)].map(match => match[1]!)
}

/** Resolve one specifier to a path under `src`, or null when it leaves this source tree. */
function resolve(fromModule: string, specifier: string): string | null {
  const target = specifier.startsWith('@/')
    ? specifier.slice(2)
    : specifier.startsWith('.')
      ? path.join(path.dirname(fromModule), specifier)
      : null

  if (target === null) return null

  for (const candidate of [
    target,
    `${target}.ts`,
    `${target}.tsx`,
    `${target}/index.ts`,
    `${target}/index.tsx`,
  ]) {
    if (candidate.endsWith('.ts') || candidate.endsWith('.tsx')) {
      if (existsSync(path.join(SRC, candidate))) return candidate
    }
  }

  return null
}

interface Module {
  readonly path: string
  readonly specifiers: string[]
}

/** Every module the application can reach from its entry, with what each one imports. */
function reachableModules(): Module[] {
  const seen = new Map<string, Module>()
  const queue = [ENTRY]

  while (queue.length > 0) {
    const current = queue.shift()!

    if (seen.has(current)) continue

    const specifiers = specifiersIn(readFileSync(path.join(SRC, current), 'utf8'))

    seen.set(current, { path: current, specifiers })

    for (const specifier of specifiers) {
      const resolved = resolve(current, specifier)

      if (resolved !== null && !seen.has(resolved)) queue.push(resolved)
    }
  }

  return [...seen.values()]
}

const modules = reachableModules()

describe('one facade between the application and any wallet', () => {
  it('reaches a real application from the entry, so an empty walk cannot pass', () => {
    expect(modules.length).toBeGreaterThan(150)
    expect(modules.map(module => module.path)).toContain('providers/walletFacade/useWallet.ts')
  })

  it('cannot reach anything the rewrite superseded, though all of it is still on disk', () => {
    const reached = modules
      .map(module => module.path)
      .filter(modulePath => SUPERSEDED.some(prefix => modulePath.startsWith(prefix)))

    expect(reached).toEqual([])

    for (const prefix of SUPERSEDED) {
      expect(existsSync(path.join(SRC, prefix))).toBe(true)
    }
  })

  it('names a wallet only below the facade', () => {
    const offenders = modules
      .filter(module => !BELOW_THE_SEAM.some(prefix => module.path.startsWith(prefix)))
      .filter(module =>
        module.specifiers.some(specifier =>
          WALLET_SPECIFIERS.some(wallet => specifier.startsWith(wallet)),
        ),
      )
      .map(module => module.path)

    expect(offenders).toEqual([])
  })

  it('asks for a wallet through one hook, at one path', () => {
    const importers = modules.filter(module =>
      module.specifiers.some(specifier => specifier.endsWith('/useWallet')),
    )

    expect(importers.length).toBeGreaterThan(30)
    for (const module of importers) {
      expect(module.specifiers.filter(specifier => specifier.endsWith('/useWallet'))).toEqual([
        '@/providers/walletFacade/useWallet',
      ])
    }
  })
})
