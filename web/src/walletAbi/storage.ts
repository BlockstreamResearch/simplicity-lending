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
  const normalized =
    address
      ?.trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-') || 'anonymous'
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

export interface WalletAbiLenderFlowState {
  offerIds: string[]
  scriptPubkeys: string[]
}

const DEFAULT_LENDER_STATE: WalletAbiLenderFlowState = {
  offerIds: [],
  scriptPubkeys: [],
}

function normalizeLenderStorageKey(identity: string | null): string {
  const normalized =
    identity
      ?.trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-') || 'anonymous'
  return `simplicity-lending.wallet-abi.lender.${normalized}`
}

function normalizeStringList(values: unknown): string[] {
  if (!Array.isArray(values)) return []

  return [
    ...new Set(
      values
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    ),
  ]
}

export function loadLenderFlowState(identity: string | null): WalletAbiLenderFlowState {
  if (typeof localStorage === 'undefined') {
    return DEFAULT_LENDER_STATE
  }

  const raw = localStorage.getItem(normalizeLenderStorageKey(identity))
  if (!raw) {
    return DEFAULT_LENDER_STATE
  }

  try {
    const parsed = JSON.parse(raw) as Partial<WalletAbiLenderFlowState>
    return {
      offerIds: normalizeStringList(parsed.offerIds),
      scriptPubkeys: normalizeStringList(parsed.scriptPubkeys),
    }
  } catch {
    return DEFAULT_LENDER_STATE
  }
}

function saveLenderFlowState(
  identity: string | null,
  patch: Partial<WalletAbiLenderFlowState>
): WalletAbiLenderFlowState {
  const current = loadLenderFlowState(identity)
  const next = {
    offerIds: normalizeStringList([...(current.offerIds ?? []), ...(patch.offerIds ?? [])]),
    scriptPubkeys: normalizeStringList([
      ...(current.scriptPubkeys ?? []),
      ...(patch.scriptPubkeys ?? []),
    ]),
  }

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(normalizeLenderStorageKey(identity), JSON.stringify(next))
  }

  return next
}

export function trackLenderOfferId(
  identity: string | null,
  offerId: string
): WalletAbiLenderFlowState {
  return saveLenderFlowState(identity, { offerIds: [offerId] })
}

export function trackLenderScriptPubkey(
  identity: string | null,
  scriptPubkeyHex: string
): WalletAbiLenderFlowState {
  return saveLenderFlowState(identity, { scriptPubkeys: [scriptPubkeyHex] })
}
