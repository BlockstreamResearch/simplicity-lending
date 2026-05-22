/**
 * Minimal Web Serial API ambient type declarations.
 *
 * The standard TypeScript DOM lib does not include Web Serial API types.
 * Only the subset used in this codebase is declared here.
 */

interface Serial extends EventTarget {
  addEventListener(type: 'connect' | 'disconnect', listener: (event: Event) => void): void
  removeEventListener(type: 'connect' | 'disconnect', listener: (event: Event) => void): void
}

interface Navigator {
  readonly serial: Serial
}
