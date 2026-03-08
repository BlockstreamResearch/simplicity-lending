import type { WalletAbiNetwork } from 'wallet-abi-sdk-alpha/schema'
import { normalizeHex } from '../utility/hex'

const STORAGE_PREFIX = 'simplicity-lending-wallet-scripts'

function storageKey(signingXOnlyPubkey: string, network: WalletAbiNetwork): string {
  return `${STORAGE_PREFIX}:${network}:${signingXOnlyPubkey.trim().toLowerCase()}`
}

function normalizeScripts(scripts: Iterable<string>): string[] {
  const unique = new Set<string>()

  for (const script of scripts) {
    const normalized = normalizeHex(script)
    if (normalized.length === 0) continue
    unique.add(normalized)
  }

  return [...unique]
}

export function loadKnownWalletScripts(
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
    return normalizeScripts(parsed.filter((value): value is string => typeof value === 'string'))
  } catch {
    return []
  }
}

export function rememberWalletScript(
  signingXOnlyPubkey: string,
  network: WalletAbiNetwork,
  scriptPubkeyHex: string
): string[] {
  if (typeof localStorage === 'undefined' || signingXOnlyPubkey.trim().length === 0) {
    return []
  }

  const normalizedScript = normalizeHex(scriptPubkeyHex)
  if (normalizedScript.length === 0) {
    return loadKnownWalletScripts(signingXOnlyPubkey, network)
  }

  const nextScripts = normalizeScripts([
    normalizedScript,
    ...loadKnownWalletScripts(signingXOnlyPubkey, network),
  ])

  localStorage.setItem(storageKey(signingXOnlyPubkey, network), JSON.stringify(nextScripts))
  return nextScripts
}
