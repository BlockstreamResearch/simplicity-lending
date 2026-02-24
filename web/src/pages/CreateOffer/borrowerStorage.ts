const BORROWER_PREPARE_TXID_KEY = 'simplicity-lending-borrower-prepare-txid'

export function getStoredPrepareTxid(accountIndex: number): string | null {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(`${BORROWER_PREPARE_TXID_KEY}-${accountIndex}`)
  return raw ?? null
}

export function savePrepareTxid(accountIndex: number, txid: string): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(`${BORROWER_PREPARE_TXID_KEY}-${accountIndex}`, txid)
}
