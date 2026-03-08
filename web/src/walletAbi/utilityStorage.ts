import type { WalletAbiNetwork } from 'wallet-abi-sdk-alpha/schema'

export interface DemoIssuedAssetRecord {
  label: string
  network: WalletAbiNetwork
  assetId: string
  reissuanceTokenId: string
  assetEntropy: string
  contractHash: string
  issuancePrevout: string
  issueTxid: string
  issueAmountSat: string
  createdAt: string
}

const STORAGE_PREFIX = 'simplicity-lending-utility-assets'

function storageKey(signingXOnlyPubkey: string, network: WalletAbiNetwork): string {
  return `${STORAGE_PREFIX}:${network}:${signingXOnlyPubkey.trim().toLowerCase()}`
}

function isWalletAbiNetwork(value: unknown): value is WalletAbiNetwork {
  return value === 'liquid' || value === 'testnet-liquid' || value === 'localtest-liquid'
}

function parseRecord(value: unknown): DemoIssuedAssetRecord | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const record = value as Record<string, unknown>
  if (
    typeof record.label !== 'string' ||
    !isWalletAbiNetwork(record.network) ||
    typeof record.assetId !== 'string' ||
    typeof record.reissuanceTokenId !== 'string' ||
    typeof record.assetEntropy !== 'string' ||
    typeof record.contractHash !== 'string' ||
    typeof record.issuancePrevout !== 'string' ||
    typeof record.issueTxid !== 'string' ||
    typeof record.issueAmountSat !== 'string' ||
    typeof record.createdAt !== 'string'
  ) {
    return null
  }

  return {
    label: record.label,
    network: record.network,
    assetId: record.assetId,
    reissuanceTokenId: record.reissuanceTokenId,
    assetEntropy: record.assetEntropy,
    contractHash: record.contractHash,
    issuancePrevout: record.issuancePrevout,
    issueTxid: record.issueTxid,
    issueAmountSat: record.issueAmountSat,
    createdAt: record.createdAt,
  }
}

export function loadDemoIssuedAssets(
  signingXOnlyPubkey: string,
  network: WalletAbiNetwork,
): DemoIssuedAssetRecord[] {
  if (signingXOnlyPubkey.trim().length === 0) {
    return []
  }

  const raw = localStorage.getItem(storageKey(signingXOnlyPubkey, network))
  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .map(parseRecord)
      .filter((record): record is DemoIssuedAssetRecord => record !== null)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  } catch {
    return []
  }
}

function saveDemoIssuedAssets(
  signingXOnlyPubkey: string,
  network: WalletAbiNetwork,
  assets: DemoIssuedAssetRecord[],
): void {
  if (signingXOnlyPubkey.trim().length === 0) {
    return
  }

  localStorage.setItem(storageKey(signingXOnlyPubkey, network), JSON.stringify(assets))
}

export function upsertDemoIssuedAsset(
  signingXOnlyPubkey: string,
  network: WalletAbiNetwork,
  asset: DemoIssuedAssetRecord,
): DemoIssuedAssetRecord[] {
  const next = [
    asset,
    ...loadDemoIssuedAssets(signingXOnlyPubkey, network).filter(
      (current) => current.assetId !== asset.assetId,
    ),
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt))

  saveDemoIssuedAssets(signingXOnlyPubkey, network, next)
  return next
}

export function removeDemoIssuedAsset(
  signingXOnlyPubkey: string,
  network: WalletAbiNetwork,
  assetId: string,
): DemoIssuedAssetRecord[] {
  const next = loadDemoIssuedAssets(signingXOnlyPubkey, network).filter(
    (current) => current.assetId !== assetId.trim(),
  )
  saveDemoIssuedAssets(signingXOnlyPubkey, network, next)
  return next
}

export function clearDemoIssuedAssets(
  signingXOnlyPubkey: string,
  network: WalletAbiNetwork,
): void {
  if (signingXOnlyPubkey.trim().length === 0) {
    return
  }

  localStorage.removeItem(storageKey(signingXOnlyPubkey, network))
}
