import {
  type Network,
  type Wollet,
  WolletBuilder,
  type WolletDescriptor,
} from '@lilbonekit/lwk-web'

import { type KvBackend, openIdbBackend } from '@/lib/sync-kv/idbBackend'
import { PersistentKv, type SyncKv } from '@/lib/sync-kv/persistentKv'

const DB_NAME = 'lwk-wallet-cache'
const STORE_NAME = 'kv'
const SCHEMA_VERSION = 'v1'
const STALE_NAMESPACE_MS = 30 * 24 * 60 * 60 * 1000

const UPDATES_PREFIX = 'u:'
const TXS_PREFIX = 't:'
const VERSION_KEY = 'm:version'
const LAST_OPENED_KEY = 'm:lastOpened'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export interface WalletCache {
  wipe(): Promise<void>
  close(): Promise<void>
}

async function walletNamespace(descriptor: WolletDescriptor): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(descriptor.toString()))
  return [...new Uint8Array(digest).slice(0, 16)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

function prefixed(kv: SyncKv, prefix: string): SyncKv {
  return {
    get: key => kv.get(prefix + key),
    put: (key, value) => kv.put(prefix + key, value),
    remove: key => kv.remove(prefix + key),
    isPersisted: () => kv.isPersisted(),
  }
}

/** Resolves to the release callback, or to null when another tab already holds the lock. */
function acquirePersistLock(name: string): Promise<(() => void) | null> {
  if (!('locks' in navigator)) return Promise.resolve(() => {})

  return new Promise(resolve => {
    navigator.locks
      .request(name, { mode: 'exclusive', ifAvailable: true }, lock => {
        if (!lock) {
          resolve(null)
          return
        }
        return new Promise<void>(release => resolve(() => release()))
      })
      .catch((err: unknown) => {
        console.warn('sync-kv: could not take the persist lock, running memory-only', err)
        resolve(null)
      })
  })
}

async function evictStaleNamespaces(backend: KvBackend, current: string): Promise<void> {
  const namespaces = new Set<string>()
  for (const key of await backend.allKeys()) {
    const end = key.indexOf(':')
    if (end === -1) continue
    const prefix = key.slice(0, end + 1)
    if (prefix !== current) namespaces.add(prefix)
  }

  const now = Date.now()
  for (const prefix of namespaces) {
    const rows = await backend.loadPrefix(prefix + LAST_OPENED_KEY)
    const lastOpened = rows.length > 0 ? Number(decoder.decode(rows[0][1])) : 0
    if (!Number.isFinite(lastOpened) || now - lastOpened > STALE_NAMESPACE_MS) {
      await backend.deletePrefix(prefix)
    }
  }
}

function stampMeta(kv: PersistentKv): void {
  kv.put(VERSION_KEY, encoder.encode(SCHEMA_VERSION))
  kv.put(LAST_OPENED_KEY, encoder.encode(String(Date.now())))
}

function buildWollet(network: Network, descriptor: WolletDescriptor, kv: PersistentKv): Wollet {
  return new WolletBuilder(network, descriptor)
    .utxoOnly(false)
    .withExperimentalStore(prefixed(kv, UPDATES_PREFIX))
    .withTxsStore(prefixed(kv, TXS_PREFIX))
    .withMergeThreshold(1)
    .build()
}

/**
 * Builds a `Wollet` backed by an IndexedDB cache, so a reconnect only downloads
 * transactions the cache doesn't already hold.
 */
export async function createCachedWollet(
  network: Network,
  descriptor: WolletDescriptor,
): Promise<{ wollet: Wollet; cache: WalletCache }> {
  const namespace = `${await walletNamespace(descriptor)}:`
  const backend = await openIdbBackend(DB_NAME, STORE_NAME)
  const release = backend ? await acquirePersistLock(`sync-kv:${namespace}`) : null
  const kv = new PersistentKv(backend, namespace, release !== null)

  await kv.hydrate()

  const storedVersion = kv.get(VERSION_KEY)
  if (!storedVersion || decoder.decode(storedVersion) !== SCHEMA_VERSION) await kv.wipe()
  stampMeta(kv)

  if (backend && release) {
    evictStaleNamespaces(backend, namespace).catch(err =>
      console.warn('sync-kv: namespace eviction failed', err),
    )
  }

  let wollet: Wollet
  try {
    wollet = buildWollet(network, descriptor, kv)
  } catch (err) {
    // Cached updates outlive the LWK version that wrote them, so a format change or a torn
    // write must degrade to a full rescan instead of leaving the wallet unable to connect.
    console.warn('sync-kv: cached wallet state is unusable, rebuilding from scratch', err)
    await kv.wipe()
    stampMeta(kv)
    wollet = buildWollet(network, descriptor, kv)
  }

  const cache: WalletCache = {
    wipe: () => kv.wipe(),
    close: async () => {
      await kv.close()
      release?.()
      backend?.close()
    },
  }

  return { wollet, cache }
}
