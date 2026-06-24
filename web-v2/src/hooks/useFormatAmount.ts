import { NETWORK_CONFIG } from '@/constants/network-config'
import { useAssetDenomination } from '@/providers/assetDenomination/useAssetDenomination'
import { formatAmount } from '@/utils/format'
import {
  formatPolicyAssetAmount,
  formatPolicyAssetDisplay,
  getPolicyAssetUnit,
} from '@/utils/policyAssetDenomination'

export function useFormatAmount() {
  const { denomination } = useAssetDenomination()
  const { collateralAsset, principalAsset } = NETWORK_CONFIG
  const collateralUnit = getPolicyAssetUnit(denomination, collateralAsset)

  return {
    denomination,
    collateralUnit,
    formatCollateralAmount: (amount: bigint) =>
      formatPolicyAssetAmount(amount, denomination, collateralAsset),
    formatCollateralDisplay: (amount: bigint) =>
      formatPolicyAssetDisplay(amount, denomination, collateralAsset),
    formatPrincipalAmount: (amount: bigint) =>
      `${formatAmount(amount, principalAsset.decimals)} ${principalAsset.symbol}`,
  }
}
