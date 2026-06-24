export type PolicyAssetDenomination = 'lbtc' | 'sats'

export const POLICY_ASSET_DENOMINATION_STORAGE_KEY =
  'simplicity-lending:policy-asset-denomination:v1'

export const DEFAULT_POLICY_ASSET_DENOMINATION: PolicyAssetDenomination = 'lbtc'

export function isPolicyAssetDenomination(value: unknown): value is PolicyAssetDenomination {
  return value === 'lbtc' || value === 'sats'
}
