import type { WalletAbiNetwork } from 'wallet-abi-sdk-alpha/schema'

const STORAGE_PREFIX = 'simplicity-lending-borrower-offers'

function storageKey(signingXOnlyPubkey: string, network: WalletAbiNetwork): string {
  return `${STORAGE_PREFIX}:${network}:${signingXOnlyPubkey.trim().toLowerCase()}`
}

function normalizeOfferIds(offerIds: Iterable<string>): string[] {
  const unique = new Set<string>()

  for (const offerId of offerIds) {
    const normalized = offerId.trim().toLowerCase()
    if (normalized.length === 0) continue
    unique.add(normalized)
  }

  return [...unique]
}

export function loadTrackedBorrowerOfferIds(
  signingXOnlyPubkey: string,
  network: WalletAbiNetwork
): string[] {
  if (typeof localStorage === 'undefined' || signingXOnlyPubkey.trim().length === 0) {
    return []
  }

  const raw = localStorage.getItem(storageKey(signingXOnlyPubkey, network))
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return normalizeOfferIds(parsed.filter((value): value is string => typeof value === 'string'))
  } catch {
    return []
  }
}

export function rememberTrackedBorrowerOfferId(
  signingXOnlyPubkey: string,
  network: WalletAbiNetwork,
  offerId: string
): string[] {
  if (typeof localStorage === 'undefined' || signingXOnlyPubkey.trim().length === 0) {
    return []
  }

  const normalizedOfferId = offerId.trim().toLowerCase()
  if (normalizedOfferId.length === 0) {
    return loadTrackedBorrowerOfferIds(signingXOnlyPubkey, network)
  }

  const nextOfferIds = normalizeOfferIds([
    normalizedOfferId,
    ...loadTrackedBorrowerOfferIds(signingXOnlyPubkey, network),
  ])

  localStorage.setItem(storageKey(signingXOnlyPubkey, network), JSON.stringify(nextOfferIds))
  return nextOfferIds
}
