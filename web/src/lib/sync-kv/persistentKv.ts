import type { KvBackend } from './idbBackend'

const FLUSH_DEBOUNCE_MS = 250

/** Storage contract LWK calls synchronously from wasm. */
export interface SyncKv {
  get(key: string): Uint8Array | undefined
  put(key: string, value: Uint8Array): void
  remove(key: string): void
  isPersisted(): boolean
}

export class PersistentKv implements SyncKv {
  private readonly entries = new Map<string, Uint8Array>()
  private readonly dirty = new Set<string>()
  private readonly deleted = new Set<string>()
  private readonly backend: KvBackend | null
  private readonly prefix: string
  private writable: boolean
  private timer: ReturnType<typeof setTimeout> | null = null
  private queue: Promise<void> = Promise.resolve()
  private detachListeners: (() => void) | null = null

  constructor(backend: KvBackend | null, prefix: string, writable: boolean) {
    this.backend = backend
    this.prefix = prefix
    this.writable = backend !== null && writable
  }

  get(key: string): Uint8Array | undefined {
    return this.entries.get(this.prefix + key)
  }

  put(key: string, value: Uint8Array): void {
    const full = this.prefix + key
    this.entries.set(full, value.slice())
    if (!this.writable) return
    this.dirty.add(full)
    this.deleted.delete(full)
    this.scheduleFlush()
  }

  remove(key: string): void {
    const full = this.prefix + key
    this.entries.delete(full)
    if (!this.writable) return
    this.deleted.add(full)
    this.dirty.delete(full)
    this.scheduleFlush()
  }

  isPersisted(): boolean {
    return true
  }

  /** Loads the namespace into memory. Must complete before LWK reads through this store. */
  async hydrate(): Promise<void> {
    if (!this.backend) return
    try {
      for (const [key, value] of await this.backend.loadPrefix(this.prefix)) {
        this.entries.set(key, value)
      }
    } catch (err) {
      console.warn('sync-kv: hydrate failed, starting from an empty cache', err)
      this.entries.clear()
    }
    this.attachListeners()
  }

  async wipe(): Promise<void> {
    this.cancelTimer()
    this.entries.clear()
    this.dirty.clear()
    this.deleted.clear()
    if (!this.backend) return
    const backend = this.backend
    this.queue = this.queue
      .then(() => backend.deletePrefix(this.prefix))
      .catch(err => console.warn('sync-kv: wipe failed', err))
    return this.queue
  }

  async close(): Promise<void> {
    await this.flush()
    this.detachListeners?.()
    this.detachListeners = null
  }

  private async flush(): Promise<void> {
    this.cancelTimer()
    if (!this.backend || (this.dirty.size === 0 && this.deleted.size === 0)) return this.queue

    const puts = new Map<string, Uint8Array>()
    for (const key of this.dirty) {
      const value = this.entries.get(key)
      if (value) puts.set(key, value)
    }
    const deletes = [...this.deleted]
    this.dirty.clear()
    this.deleted.clear()

    const backend = this.backend
    this.queue = this.queue
      .then(() => backend.commit(puts, deletes))
      .catch(err => this.degradeToMemoryOnly(err))
    return this.queue
  }

  private scheduleFlush(): void {
    if (this.timer !== null) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, FLUSH_DEBOUNCE_MS)
  }

  private cancelTimer(): void {
    if (this.timer === null) return
    clearTimeout(this.timer)
    this.timer = null
  }

  private degradeToMemoryOnly(err: unknown): void {
    this.writable = false
    this.dirty.clear()
    this.deleted.clear()
    console.warn('sync-kv: write failed, wallet cache is memory-only from now on', err)
  }

  private attachListeners(): void {
    if (this.detachListeners || typeof window === 'undefined') return

    const flushOnHide = () => {
      if (document.visibilityState === 'hidden') void this.flush()
    }
    const flushOnPageHide = () => void this.flush()

    document.addEventListener('visibilitychange', flushOnHide)
    window.addEventListener('pagehide', flushOnPageHide)

    this.detachListeners = () => {
      document.removeEventListener('visibilitychange', flushOnHide)
      window.removeEventListener('pagehide', flushOnPageHide)
    }
  }
}
