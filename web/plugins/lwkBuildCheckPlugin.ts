import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import type { Plugin } from 'vite'

// Stops `pnpm dev` / `pnpm build` when the LWK build in lwk/lwk_wasm/pkg is missing or
// was built from a different commit than the one the repo pins (e.g. after `git pull`).
export function lwkBuildCheckPlugin(webRoot: string): Plugin {
  return {
    name: 'lwk-build-check',
    config() {
      checkLwkBuild(path.resolve(webRoot, '..'))
    },
  }
}

function checkLwkBuild(repoRoot: string): void {
  const pkgDir = path.join(repoRoot, 'lwk/lwk_wasm/pkg')
  if (!fs.existsSync(path.join(pkgDir, 'package.json'))) {
    fail('LWK is not built yet.')
  }

  const pinned = readPinnedCommit(repoRoot)
  if (!pinned) return

  const stampFile = path.join(pkgDir, '.lwk-commit')
  const built = fs.existsSync(stampFile) ? fs.readFileSync(stampFile, 'utf8').trim() : null
  if (built === pinned) return

  fail(
    built
      ? `LWK was built from ${built.slice(0, 9)}, but the repo now expects ${pinned.slice(0, 9)}.`
      : 'LWK was built without a version stamp, so it may be outdated.',
  )
}

function readPinnedCommit(repoRoot: string): string | null {
  try {
    const entry = execFileSync('git', ['ls-files', '--stage', 'lwk'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString()
    return entry.split(/\s+/)[1] || null
  } catch {
    return null
  }
}

function fail(message: string): never {
  console.error(
    [
      '',
      `ERROR: ${message}`,
      '',
      'Fix (run from the repo root):',
      '  git submodule update --init lwk',
      '  cd web && pnpm lwk:build',
      '',
    ].join('\n'),
  )
  process.exit(1)
}
