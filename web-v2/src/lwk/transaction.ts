import { type AssetId, type OutPoint, type Script, Transaction, type TxOut } from 'lwk_web'

import { fetchTxRaw } from '@/api/esplora/methods'

export async function fetchTransaction(outpoint: OutPoint): Promise<Transaction> {
  return Transaction.fromBytes(await fetchTxRaw(outpoint.txid().toString()))
}

export function requireTxOut(tx: Transaction, vout: number, label: string): TxOut {
  const txOut = tx.outputs[vout]
  if (!txOut) throw new Error(`${label} transaction does not have output ${vout}`)
  return txOut
}

export function requireExplicitAsset(txOut: TxOut, label: string): AssetId {
  const asset = txOut.asset()
  if (!asset) throw new Error(`${label} output must have an explicit asset`)
  return asset
}

export function requireExplicitAmount(txOut: TxOut, label: string): bigint {
  const amount = txOut.value()
  if (amount === undefined) throw new Error(`${label} output must have an explicit amount`)
  return amount
}

export function assertExplicitAmount(txOut: TxOut, expectedAmount: bigint, label: string): void {
  const amount = requireExplicitAmount(txOut, label)
  if (amount !== expectedAmount) {
    throw new Error(`${label} output must have amount ${expectedAmount.toString()}`)
  }
}

export function assertDistinctOutpoints(outpoints: OutPoint[], message: string): void {
  const values = outpoints.map(outpoint => `${outpoint.txid().toString()}:${outpoint.vout()}`)
  if (new Set(values).size !== values.length) {
    throw new Error(message)
  }
}

export function assertScriptMatches(actual: Script, expected: Script, message: string): void {
  const actualBytes = actual.bytes()
  const expectedBytes = expected.bytes()
  const matches =
    actualBytes.length === expectedBytes.length &&
    actualBytes.every((byte, index) => byte === expectedBytes[index])

  if (!matches) throw new Error(message)
}
