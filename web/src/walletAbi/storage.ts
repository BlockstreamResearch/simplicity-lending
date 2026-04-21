export interface WalletAbiBorrowerFlowState {
  prepareTxId: string | null
  auxiliaryAssetId: string | null
  issuanceEntropyHex: string | null
  issuanceTxId: string | null
  firstParametersNftAssetId: string | null
  secondParametersNftAssetId: string | null
  borrowerNftAssetId: string | null
  lenderNftAssetId: string | null
  collateralAmount: string | null
  principalAmount: string | null
  loanExpirationTime: number | null
  interestRateBasisPoints: number | null
}

const DEFAULT_STATE: WalletAbiBorrowerFlowState = {
  prepareTxId: null,
  auxiliaryAssetId: null,
  issuanceEntropyHex: null,
  issuanceTxId: null,
  firstParametersNftAssetId: null,
  secondParametersNftAssetId: null,
  borrowerNftAssetId: null,
  lenderNftAssetId: null,
  collateralAmount: null,
  principalAmount: null,
  loanExpirationTime: null,
  interestRateBasisPoints: null,
}

function normalizeStorageKey(address: string | null): string {
  const normalized = address?.trim().toLowerCase().replace(/[^a-z0-9]/g, '-') || 'anonymous'
  return `simplicity-lending.wallet-abi.borrower.${normalized}`
}

export function loadBorrowerFlowState(address: string | null): WalletAbiBorrowerFlowState {
  if (typeof localStorage === 'undefined') {
    return DEFAULT_STATE
  }

  const raw = localStorage.getItem(normalizeStorageKey(address))
  if (!raw) {
    return DEFAULT_STATE
  }

  try {
    const parsed = JSON.parse(raw) as Partial<WalletAbiBorrowerFlowState>
    return {
      ...DEFAULT_STATE,
      ...parsed,
    }
  } catch {
    return DEFAULT_STATE
  }
}

export function saveBorrowerFlowState(
  address: string | null,
  patch: Partial<WalletAbiBorrowerFlowState>
): WalletAbiBorrowerFlowState {
  const next = {
    ...loadBorrowerFlowState(address),
    ...patch,
  }

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(normalizeStorageKey(address), JSON.stringify(next))
  }

  return next
}

export function clearBorrowerFlowState(address: string | null): void {
  if (typeof localStorage === 'undefined') {
    return
  }

  localStorage.removeItem(normalizeStorageKey(address))
}

