import { type DBSchema, type IDBPDatabase, openDB } from 'idb'

import { normalizeHex } from '@/utils/hex'

import type { PendingTxRecord } from './types'

const DB_NAME = 'simplicity-lending:pending-transactions'
const DB_VERSION = 1
const STORE_NAME = 'pending-tx'
const WALLET_INDEX = 'by-wallet-script-pubkey'

interface PendingTxDBSchema extends DBSchema {
  [STORE_NAME]: {
    key: string
    value: PendingTxRecord
    indexes: { [WALLET_INDEX]: string }
  }
}

let dbPromise: Promise<IDBPDatabase<PendingTxDBSchema>> | null = null

function getDb(): Promise<IDBPDatabase<PendingTxDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<PendingTxDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'txid' })
        store.createIndex(WALLET_INDEX, 'walletScriptPubkey')
      },
    })
  }
  return dbPromise
}

export async function loadPendingTxsForWallet(
  walletScriptPubkey: string,
): Promise<PendingTxRecord[]> {
  const db = await getDb()
  return db.getAllFromIndex(STORE_NAME, WALLET_INDEX, normalizeHex(walletScriptPubkey))
}

export async function putPendingTx(record: PendingTxRecord): Promise<void> {
  const db = await getDb()
  await db.put(STORE_NAME, {
    ...record,
    walletScriptPubkey: normalizeHex(record.walletScriptPubkey),
  })
}

export async function deletePendingTx(txid: string): Promise<void> {
  const db = await getDb()
  await db.delete(STORE_NAME, txid)
}
