import { type ConfigAsset, NETWORK_CONFIG } from '@/constants/network-config'
import type { PolicyAssetDenomination } from '@/providers/assetDenomination/types'
import { toBigintAmount } from '@/utils/bigint'
import { formatAmount } from '@/utils/format'

const GROUP_LOCALE = 'en-US'
const INTEGER_AMOUNT_RE = /^\d+$/
const GROUPED_INTEGER_AMOUNT_RE = /^\d{1,3}(,\d{3})*$/

function normalizeIntegerInput(value: string): string {
  return value.trim().replaceAll(',', '')
}

export function isPolicyAsset(asset: ConfigAsset): boolean {
  return asset.id === NETWORK_CONFIG.collateralAsset.id
}

export function getPolicyAssetUnit(
  denomination: PolicyAssetDenomination,
  asset: ConfigAsset = NETWORK_CONFIG.collateralAsset,
): string {
  return denomination === 'sats' ? 'sats' : asset.symbol
}

export function formatPolicyAssetAmount(
  amount: bigint,
  denomination: PolicyAssetDenomination,
  asset: ConfigAsset = NETWORK_CONFIG.collateralAsset,
): string {
  if (denomination === 'sats') return amount.toLocaleString(GROUP_LOCALE)
  return formatAmount(amount, asset.decimals)
}

export function formatPolicyAssetInputValue(
  amount: bigint,
  denomination: PolicyAssetDenomination,
  asset: ConfigAsset = NETWORK_CONFIG.collateralAsset,
): string {
  if (denomination === 'sats') return amount.toString()
  return formatAmount(amount, asset.decimals)
}

export function formatPolicyAssetDisplay(
  amount: bigint,
  denomination: PolicyAssetDenomination,
  asset: ConfigAsset = NETWORK_CONFIG.collateralAsset,
): string {
  return `${formatPolicyAssetAmount(amount, denomination, asset)} ${getPolicyAssetUnit(
    denomination,
    asset,
  )}`
}

export function parsePolicyAssetInput(
  value: string | undefined,
  denomination: PolicyAssetDenomination,
  asset: ConfigAsset = NETWORK_CONFIG.collateralAsset,
): bigint | null {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) return 0n

  if (denomination === 'sats') {
    if (!INTEGER_AMOUNT_RE.test(trimmed) && !GROUPED_INTEGER_AMOUNT_RE.test(trimmed)) return null
    return BigInt(normalizeIntegerInput(trimmed))
  }

  const decimalRe = new RegExp(`^\\d+(\\.\\d{0,${asset.decimals}})?$`)
  if (!decimalRe.test(trimmed)) return null
  return toBigintAmount(trimmed, asset.decimals)
}
