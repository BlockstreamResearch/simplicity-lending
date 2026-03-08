const BORROWER_STORAGE_PREFIX = 'simplicity-lending-borrower-flow'

export interface BorrowerFlowState {
  prepareTxid: string | null
  issuanceTxid: string | null
}

const DEFAULT_STATE: BorrowerFlowState = {
  prepareTxid: null,
  issuanceTxid: null,
}

function keyFor(signingXOnlyPubkey: string): string {
  return `${BORROWER_STORAGE_PREFIX}:${signingXOnlyPubkey.trim().toLowerCase()}`
}

export function loadBorrowerFlowState(signingXOnlyPubkey: string): BorrowerFlowState {
  if (typeof localStorage === 'undefined') return DEFAULT_STATE
  const raw = localStorage.getItem(keyFor(signingXOnlyPubkey))
  if (!raw) return DEFAULT_STATE
  try {
    const parsed = JSON.parse(raw) as Partial<BorrowerFlowState>
    return {
      prepareTxid:
        typeof parsed.prepareTxid === 'string' && parsed.prepareTxid.trim().length > 0
          ? parsed.prepareTxid
          : null,
      issuanceTxid:
        typeof parsed.issuanceTxid === 'string' && parsed.issuanceTxid.trim().length > 0
          ? parsed.issuanceTxid
          : null,
    }
  } catch {
    return DEFAULT_STATE
  }
}

export function saveBorrowerFlowState(
  signingXOnlyPubkey: string,
  state: BorrowerFlowState
): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(keyFor(signingXOnlyPubkey), JSON.stringify(state))
}

export function clearBorrowerFlowState(signingXOnlyPubkey: string): void {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(keyFor(signingXOnlyPubkey))
}
