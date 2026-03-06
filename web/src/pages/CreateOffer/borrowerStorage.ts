const BORROWER_PREPARE_TXID_KEY = 'simplicity-lending-borrower-prepare-txid'
const BORROWER_AUXILIARY_ASSET_ID_KEY = 'simplicity-lending-borrower-auxiliary-asset-id'
const BORROWER_PREPARE_FIRST_VOUT_KEY = 'simplicity-lending-borrower-prepare-first-vout'
const BORROWER_ISSUANCE_TXID_KEY = 'simplicity-lending-borrower-issuance-txid'

export function getStoredPrepareTxid(accountIndex: number): string | null {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(`${BORROWER_PREPARE_TXID_KEY}-${accountIndex}`)
  return raw ?? null
}

export function savePrepareTxid(accountIndex: number, txid: string): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(`${BORROWER_PREPARE_TXID_KEY}-${accountIndex}`, txid)
}

export function clearStoredPrepareTxid(accountIndex: number): void {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(`${BORROWER_PREPARE_TXID_KEY}-${accountIndex}`)
}

export function getStoredAuxiliaryAssetId(accountIndex: number): string | null {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(`${BORROWER_AUXILIARY_ASSET_ID_KEY}-${accountIndex}`)
  return raw ?? null
}

export function saveStoredAuxiliaryAssetId(accountIndex: number, assetId: string): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(`${BORROWER_AUXILIARY_ASSET_ID_KEY}-${accountIndex}`, assetId.trim())
}

export function clearStoredAuxiliaryAssetId(accountIndex: number): void {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(`${BORROWER_AUXILIARY_ASSET_ID_KEY}-${accountIndex}`)
}

/** First vout of the 4 prepare UTXOs (0 when created in-app, user-set when imported). */
export function getStoredPrepareFirstVout(accountIndex: number): number {
  if (typeof localStorage === 'undefined') return 0
  const raw = localStorage.getItem(`${BORROWER_PREPARE_FIRST_VOUT_KEY}-${accountIndex}`)
  if (raw == null) return 0
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

export function saveStoredPrepareFirstVout(accountIndex: number, firstVout: number): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(`${BORROWER_PREPARE_FIRST_VOUT_KEY}-${accountIndex}`, String(firstVout))
}

export function clearStoredPrepareFirstVout(accountIndex: number): void {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(`${BORROWER_PREPARE_FIRST_VOUT_KEY}-${accountIndex}`)
}

export function getStoredIssuanceTxid(accountIndex: number): string | null {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(`${BORROWER_ISSUANCE_TXID_KEY}-${accountIndex}`)
  return raw ?? null
}

export function saveStoredIssuanceTxid(accountIndex: number, txid: string): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(`${BORROWER_ISSUANCE_TXID_KEY}-${accountIndex}`, txid.trim())
}

export function clearStoredIssuanceTxid(accountIndex: number): void {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(`${BORROWER_ISSUANCE_TXID_KEY}-${accountIndex}`)
}
