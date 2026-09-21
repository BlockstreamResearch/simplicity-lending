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

/**
 * Modules kept for the adapters they will become, which nothing may reach today.
 *
 * An entry leaves this list when the module stops being superseded, which is what happens when it
 * becomes part of an adapter rather than the thing an adapter replaced. Each departure is stated
 * where it happens, so the list shrinking is a decision that was made rather than a test that was
 * quieted.
 *
 * Left with the seed wallet, which now stands behind the facade and reaches them:
 *   - `lib/wallet-core/connector/seed.ts`, `connector/types.ts`, `connector/errors.ts` and
 *     `types.ts`, which are the seed connector and the vocabulary every connector speaks;
 *   - `lib/wallet-core/store/walletCache.ts` and `lib/wallet-core/wallet/sync.ts`, which are the
 *     cached wallet object and the chain sync the facade's own session now owns;
 *   - `hooks/useCreateOffer.ts`, which is not a superseded way of creating an offer but the
 *     builder that creates one — a wallet holding a key in this page performs the action by
 *     calling it, exactly as the demo page did.
 * `pages/Demo/CreateOfferDemo.tsx` stays: the developer page around that builder is superseded
 * even though the builder is not.
 *
 * Left with the Jade wallet: `lib/wallet-core/connector/jade.ts`, which is now that adapter's
 * connector, and `components/JadeUnlockModal.tsx`, which is not a superseded way of unlocking a
 * device but the only one — rewired to read the facade, and mounted in the layout again.
 *
 * Left with the SideSwap wallet: `lib/wallet-core/connector/sideswap.ts` and the generated
 * `connector/sideswap/rp_api/` types it speaks the relay's protocol in.
 *
 * Left with the picker: `components/MnemonicInput.tsx`, which is how a recovery phrase is entered
 * and was never replaced by anything. `components/modals/ConnectWalletModal.tsx` stays — the
 * picker that reached each wallet directly is superseded by the one that asks the facade.
 */
const SUPERSEDED = [
  'providers/wallet/',
  'providers/humid/',
  'components/modals/ConnectWalletModal.tsx',
  // Its own account chip, from before the facade existed. The wallet button beside it shows the
  // same account, and two of them in one header is one too many.
  'components/HumidAccountButton.tsx',
  'pages/Demo/WalletDemo.tsx',
  // Creating a borrower account by building the transaction here. The wallet builds it now, from
  // the protocol's own document; what is left on disk is the reading half's starting point.
  'hooks/useBorrowerAccount.ts',
  // The developer page around the create-offer builder, written around outpoints it chose.
  'pages/Demo/CreateOfferDemo.tsx',
]

/**
 * The facade. Everything below it may name a wallet; nothing above it may.
 *
 * `lib/wallet-core/connector/` is below it too, and only that: a connector naming another
 * connector is a wallet talking to itself rather than a screen reaching past the seam. The wider
 * prefix would have exempted any other file under `lib/wallet-core/` as well, so one could
 * re-export a connector and be imported by a screen with neither hop noticed.
 */
const BELOW_THE_SEAM = [
  'lib/humid/',
  'lib/wallet/',
  'lib/wallet-core/connector/',
  'api/wallet/',
  'providers/walletFacade/',
]

/**
 * Naming any of these is reaching a wallet rather than asking the facade for one.
 *
 * One entry per wallet, and per the connectors they are built on. A list that named only the
 * extension guarded one wallet in four: a screen could import a device adapter or a connector
 * outright and this would report nothing, which is the shape of a guard that has quietly stopped
 * covering what it claims.
 */
const WALLET_MODULES = [
  'lib/humid/appkit',
  'lib/wallet/humid/',
  'lib/wallet/jade/',
  'lib/wallet/seed/',
  'lib/wallet/sideswap/',
  'lib/wallet-core/connector/',
]

/** The same, for wallets that are packages rather than files in this tree. */
const WALLET_PACKAGES = ['@reown/appkit']

/**
 * How an import names what it is importing, in every quote this language has.
 *
 * A backtick is the third one, and reading only the other two made a dynamic import written with
 * backticks invisible — not judged, and not followed either, so the module it reached never
 * entered the walk at all. That blinded both halves at once: a screen could reach a wallet, or the
 * provider this whole rewrite superseded, and every case here passed.
 *
 * There are three forms as well as three quotes, and the third has the same consequence: `import
 * '…'` for its effects alone names no binding, so it matches neither `from` nor `import(`. A
 * reachable module could import a superseded module and a wallet outright, in the plainest syntax
 * there is, and this file stayed green.
 *
 * Two more reach a module without importing it in so many words. `import.meta.glob('…/*\/…')` is
 * how a build loads a directory at once — one line of it reaches every wallet adapter there is —
 * and `new URL('…', import.meta.url)` is how a worker is pointed at a file. Both are ordinary
 * convenience rather than evasion, which is the class this file says it covers.
 */
const IMPORT_PATTERN =
  /(?:from\s*|import\s*\(\s*|import\s+|import\.meta\.glob\s*\(\s*|new\s+URL\s*\(\s*)['"`]([^'"`]+)['"`]/g

/**
 * Where a name is filled in later, leaving only the part before it to judge.
 *
 * Two ways of writing the same thing: a template's `${…}` is filled in as the page runs, a glob's
 * `*` as the build resolves it. Either way what is written down stops short of naming one module.
 */
const FILLED_IN_LATER = /\$\{|\*/u

function specifiersIn(source: string): string[] {
  return [...source.matchAll(IMPORT_PATTERN)].map(match => match[1]!)
}

/**
 * Where one import points inside `src`, or null when it leaves this source tree.
 *
 * The path is worked out from the specifier alone, whether or not a file is there. What is on disk
 * decides whether the walk follows it; where it *points* decides whether it names a wallet, and
 * those are different questions. Answering the second with the first let one spelling through:
 * `@/lib/wallet/jade/adapter.js` matched no file this walk knew to look for, was taken for a
 * package, and was cleared against a list of package names — while Vite and TypeScript both
 * resolved it to the adapter and imported it.
 */
function targetOf(fromModule: string, specifier: string): string | null {
  // Normalised, both branches. `..` and doubled slashes are spellings, not destinations: a module
  // reached by `@/lib/wallet-core/../wallet/jade/adapter` is the jade adapter, and comparing the
  // string as written let exactly that through while `path.join` was quietly normalising the
  // relative form. It also made an offender's own path fail to match the modules below the seam,
  // so a wallet flagged by one of these spellings named the wrong file.
  // The leading slashes go with the alias: `@//lib/…` is what `@/lib/…` is, and a target that
  // kept one began with no prefix in any list here — neither a wallet nor below the seam, which
  // is how one spelling was cleared and three others blamed the adapter instead of the screen.
  // `/src/…` is the third way in, and the one `import.meta.glob` hands its own keys back as, so
  // it is what somebody copying a path out of those keys writes. Vite serves it natively.
  const rooted = /^\/+src\//u.exec(specifier)

  const written = rooted
    ? specifier.slice(rooted[0].length)
    : specifier.startsWith('@/')
      ? specifier.slice(2).replace(/^\/+/u, '')
      : specifier.startsWith('.')
        ? path.join(path.dirname(fromModule), specifier)
        : null

  if (written === null) return null

  // Said as one path from `src`, whatever route the specifier took to get there. A relative
  // specifier can leave this tree and walk back into it — `../../src/lib/wallet/jade/adapter`
  // from a component is the jade adapter — and a path still carrying that detour matched nothing
  // here, so the offender named was the adapter rather than the screen that reached for it.
  const absolute = path.resolve(SRC, written)

  return absolute.startsWith(`${SRC}${path.sep}`) ? path.relative(SRC, absolute) : null
}

/** The file one import lands on, or null when there is none to follow. */
function resolve(fromModule: string, specifier: string): string | null {
  const target = targetOf(fromModule, specifier)

  if (target === null) return null

  // A specifier may be written with the extension the build emits rather than the one on disk.
  const written = target.replace(/\.jsx?$/u, '')

  for (const candidate of [
    target,
    written,
    `${written}.ts`,
    `${written}.tsx`,
    `${written}/index.ts`,
    `${written}/index.tsx`,
  ]) {
    if (candidate.endsWith('.ts') || candidate.endsWith('.tsx')) {
      if (existsSync(path.join(SRC, candidate))) return candidate
    }
  }

  return null
}

/**
 * Whether a path sits under one of these prefixes, or is the directory one names.
 *
 * Compared without case, because the filesystem this is read from may be: `lib/Wallet/jade` opens
 * the same file as `lib/wallet/jade` on a Mac, and a comparison that cared would clear it. Where
 * the filesystem does care, such an import is broken and flagging it costs nothing.
 */
function under(pathish: string, prefixes: readonly string[]): boolean {
  const lowered = pathish.toLowerCase()

  return prefixes.some(prefix => {
    const wanted = prefix.toLowerCase()

    return lowered === wanted.replace(/\/$/u, '') || lowered.startsWith(wanted)
  })
}

/*
 * What this guard does not claim.
 *
 * It reads source with a regular expression, so `import/* a comment *\/('@/lib/wallet/…')` gets
 * past it — nothing short of parsing the file properly closes that class, and a parser is out of
 * proportion to what this is for. It catches what an engineer writes by accident or by
 * convenience, in every form of that anyone tried; it is not a defence against someone writing a
 * thing deliberately to slip by it.
 */

/**
 * Whether one import reaches a wallet, whatever it is written as.
 *
 * The module it lands on is what decides, not the string: `@/lib/wallet/jade/adapter` and
 * `../lib/wallet/jade/adapter` are the same file. A specifier that leaves this tree is a package,
 * and only its own name can be compared.
 */
function pointsInto(fromModule: string, specifier: string, prefixes: readonly string[]): boolean {
  const target = targetOf(fromModule, specifier)

  if (target === null) return false

  const points = target.replace(/\.jsx?$/u, '')

  /*
   * A name filled in at runtime is judged by what is written around it. `@/lib/wallet/${which}`
   * is whichever wallet `which` holds, and the honest answer to "which wallet does this reach"
   * is any of them — so a specifier whose fixed part could still arrive at one counts as naming
   * one.
   */
  const fillsIn = FILLED_IN_LATER.exec(points)

  if (fillsIn) {
    const fixed = points.slice(0, fillsIn.index).toLowerCase()

    // Both directions: the fixed part could still arrive at one of these, or it is already inside
    // one. Asking only the first cleared a specifier that spelled a whole path and then filled in
    // after it, because no prefix starts with something longer than itself.
    return prefixes.some(
      prefix => prefix.toLowerCase().startsWith(fixed) || fixed.startsWith(prefix.toLowerCase()),
    )
  }

  // A directory names what is in it as surely as a file does: `@/lib/wallet/jade` is the adapter,
  // through whatever index file is there or is added later.
  return under(points, prefixes)
}

/**
 * Whether one import reaches a wallet, whatever it is written as.
 *
 * Only a specifier that leaves this tree is a package. One that points into it is judged by where
 * it points, found or not — an import this walk cannot follow is the one case where clearing it
 * would be guessing in the offender's favour.
 */
function namesAWallet(fromModule: string, specifier: string): boolean {
  if (targetOf(fromModule, specifier) === null) {
    return WALLET_PACKAGES.some(wallet => specifier.startsWith(wallet))
  }

  return pointsInto(fromModule, specifier, WALLET_MODULES)
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
    const reached = modules.map(module => module.path).filter(one => under(one, SUPERSEDED))

    // What the walk could not follow to a file is still an import of something: a glob over a
    // directory holding a superseded module reaches it, and resolves to no single file to be
    // caught by the line above.
    const asked = modules
      .filter(module =>
        module.specifiers.some(specifier => pointsInto(module.path, specifier, SUPERSEDED)),
      )
      .map(module => module.path)

    expect([...reached, ...asked]).toEqual([])

    for (const prefix of SUPERSEDED) {
      expect(existsSync(path.join(SRC, prefix))).toBe(true)
    }
  })

  it('would notice a screen that reached a wallet directly, however the import is spelled', () => {
    /*
     * The check run over a screen that does what it forbids, in both spellings.
     *
     * A guard that compared the written specifier missed the relative one: this tree uses
     * `../lib/...` in a dozen places and nothing forbids it, so `'@/lib/wallet/jade/adapter'` was
     * caught and `'../lib/wallet/jade/adapter'` walked straight past. What is compared now is the
     * module each import lands on, which is the same module either way.
     */
    const reachingDirectly = [
      '@/lib/wallet/humid/adapter',
      '@/lib/wallet/jade/adapter',
      '@/lib/wallet/seed/adapter',
      '@/lib/wallet/sideswap/adapter',
      '@/lib/wallet-core/connector/jade',
      '@/lib/wallet-core/connector/seed',
      '@/lib/wallet-core/connector/sideswap',
      '@reown/appkit',
      '../lib/wallet/jade/adapter',
      '../lib/wallet/seed/adapter',
      '../lib/wallet-core/connector/jade',
      // Written with the extension the build emits, which Vite and TypeScript both resolve to the
      // adapter and this walk finds no file for.
      '@/lib/wallet/jade/adapter.js',
      '../lib/wallet/seed/adapter.js',
      // Spellings, not destinations: each of these is the same adapter.
      '@/lib/wallet//jade/adapter',
      '@/lib/./wallet/jade/adapter',
      '@/lib/wallet-core/../wallet/jade/adapter',
      '@/lib/wallet/jade/../seed/adapter',
      '@/lib/wallet/jade',
      '@//lib/wallet/jade/adapter',
      '@//lib/wallet-core/connector/errors',
      '@/lib/Wallet/jade/adapter',
      // Out of this tree and back into it: still the same adapter.
      '../../src/lib/wallet/jade/adapter',
      // Whichever wallet the variable holds, which is any of them.
      '@/lib/wallet/${which}/adapter',
      // Already inside one, and interpolating after it.
      '@/lib/wallet/jade/adapter${x}.ts',
      // One line that reaches every wallet adapter there is.
      '@/lib/wallet/*/adapter.ts',
      '@/lib/wallet-core/connector/*',
      // The third way in, and the one a glob hands its own keys back as.
      '/src/lib/wallet/jade/adapter',
      '/src/lib/wallet/*/adapter.ts',
    ]

    for (const specifier of reachingDirectly) {
      expect(
        namesAWallet('components/RogueScreen.tsx', specifier),
        `a screen importing ${specifier} would not be noticed`,
      ).toBe(true)
    }
  })

  it('names a wallet only below the facade', () => {
    const offenders = modules
      .filter(module => !under(module.path, BELOW_THE_SEAM))
      .filter(module => module.specifiers.some(specifier => namesAWallet(module.path, specifier)))
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
