import { type EsploraClient, type Transaction, TxOpt, type Wollet } from '@lilbonekit/lwk-web'

import { isConfirmedWalletUtxo } from '@/lwk/utxo'

export interface WalletBalances {
  total: Record<string, string>
  confirmed: Record<string, string>
  /** total - confirmed per assetId. Only present for assets with a nonzero pending amount. */
  pending: Record<string, string>
}

/**
 * Derives total/confirmed/pending balances from the wollet's current in-memory state.
 * No network calls — safe to call right after a local mutation like applyTransaction().
 */
export function readWalletBalances(wollet: Wollet): WalletBalances {
  const total: Record<string, string> = {}
  for (const [assetId, amount] of wollet.balance().entries() as [string, bigint][]) {
    total[assetId] = amount.toString()
  }

  const confirmedAmounts = new Map<string, bigint>()
  for (const utxo of wollet.utxos()) {
    if (!isConfirmedWalletUtxo(utxo)) continue
    const unblinded = utxo.unblinded()
    const assetId = unblinded.asset().toString()
    confirmedAmounts.set(assetId, (confirmedAmounts.get(assetId) ?? 0n) + unblinded.value())
  }
  const confirmed: Record<string, string> = {}
  for (const [assetId, amount] of confirmedAmounts) {
    confirmed[assetId] = amount.toString()
  }

  const pending: Record<string, string> = {}
  for (const [assetId, totalAmount] of Object.entries(total)) {
    const pendingAmount = BigInt(totalAmount) - (confirmedAmounts.get(assetId) ?? 0n)
    if (pendingAmount !== 0n) pending[assetId] = pendingAmount.toString()
  }

  return { total, confirmed, pending }
}

/**
 * Syncs wallet state via waterfalls fullScan and applies the update.
 * Returns the updated total and confirmed-only balance maps.
 */
export async function syncBalances(
  wollet: Wollet,
  esploraClient: EsploraClient,
): Promise<WalletBalances> {
  const update = await esploraClient.fullScanToIndex(wollet, 0)
  if (update) {
    wollet.applyUpdate(update)
  }
  return readWalletBalances(wollet)
}

/**
 * Applies a just-broadcast transaction to the wallet's local state and returns the
 * updated balances immediately — no network round trip, so it can't race the indexer.
 * A later full scan (syncBalances) still reconciles confirmations over time.
 */
export function applyBroadcastTransaction(wollet: Wollet, tx: Transaction): WalletBalances {
  wollet.applyTransaction(tx)
  return readWalletBalances(wollet)
}

/**
 * Re-applies still-untracked self-broadcast txs after a full scan, in case that scan
 * was a stale snapshot that undid their local effect. Returns txids the indexer now
 * genuinely confirms, so the caller can stop tracking them.
 */
export function reconcilePendingBroadcasts(
  wollet: Wollet,
  pending: Map<string, Transaction>,
): string[] {
  const confirmedTxids: string[] = []
  for (const [txid, tx] of pending) {
    const height = wollet.txDetails(tx.txid(), TxOpt.default())?.height()
    if (height !== undefined) {
      confirmedTxids.push(txid)
      continue
    }
    try {
      wollet.applyTransaction(tx)
    } catch (err) {
      console.warn(err)
    }
  }
  return confirmedTxids
}
