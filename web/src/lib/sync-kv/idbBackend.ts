import { type IDBPDatabase, openDB } from 'idb'

export interface KvBackend {
  loadPrefix(prefix: string): Promise<[string, Uint8Array][]>
  commit(puts: Map<string, Uint8Array>, deletes: string[]): Promise<void>
  deletePrefix(prefix: string): Promise<void>
  allKeys(): Promise<string[]>
  close(): void
}

/** IndexedDB has no prefix query: \uffff sorts above every key starting with `prefix`. */
function prefixRange(prefix: string): IDBKeyRange {
  return IDBKeyRange.bound(prefix, prefix + '\uffff', false, true)
}

export async function openIdbBackend(dbName: string, storeName: string): Promise<KvBackend | null> {
  if (typeof indexedDB === 'undefined') return null

  let db: IDBPDatabase
  try {
    db = await openDB(dbName, 1, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(storeName)) {
          database.createObjectStore(storeName)
        }
      },
    })
  } catch (err) {
    console.warn('sync-kv: IndexedDB unavailable, running memory-only', err)
    return null
  }

  return {
    async loadPrefix(prefix) {
      const range = prefixRange(prefix)
      const tx = db.transaction(storeName, 'readonly')
      const [keys, values] = await Promise.all([
        tx.store.getAllKeys(range),
        tx.store.getAll(range),
        tx.done,
      ])
      return keys.map((key, i) => [String(key), values[i] as Uint8Array])
    },

    async commit(puts, deletes) {
      const tx = db.transaction(storeName, 'readwrite')
      for (const [key, value] of puts) {
        void tx.store.put(value, key)
      }
      for (const key of deletes) {
        void tx.store.delete(key)
      }
      await tx.done
    },

    async deletePrefix(prefix) {
      const tx = db.transaction(storeName, 'readwrite')
      await tx.store.delete(prefixRange(prefix))
      await tx.done
    },

    async allKeys() {
      const keys = await db.getAllKeys(storeName)
      return keys.map(String)
    },

    close() {
      db.close()
    },
  }
}
