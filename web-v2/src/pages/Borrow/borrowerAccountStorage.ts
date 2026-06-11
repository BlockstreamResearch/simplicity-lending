// TODO: remove this file
// This is a test implementation of borrower account storage using localStorage.
// It is not intended for production use and will be replaced with a backend solution in the future.
const STORAGE_KEY = 'borrower-accounts'

export interface StoredBorrowerAccount {
  factoryAssetId: string
  factoryAuthOutpoint: string
  issuanceFactoryOutpoint: string
}

function readAll(): Record<string, StoredBorrowerAccount> {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, StoredBorrowerAccount>
  } catch {
    return {}
  }
}

export function getBorrowerAccount(pubkey: string): StoredBorrowerAccount | null {
  return readAll()[pubkey] ?? null
}

export function saveBorrowerAccount(pubkey: string, account: StoredBorrowerAccount): void {
  const all = readAll()
  all[pubkey] = account
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
}
