import { useAssetPriceUsd } from '@/api/prices/hooks'
import { type ConfigAsset } from '@/constants/network-config'
import { useAssetDenomination } from '@/providers/assetDenomination/useAssetDenomination'
import { formatAmount, formatUsd } from '@/utils/format'
import {
  formatPolicyAssetAmount,
  getPolicyAssetUnit,
  isPolicyAsset,
} from '@/utils/policyAssetDenomination'

interface BalanceCardProps {
  asset: ConfigAsset
  amount: bigint
  className?: string
}

export default function BalanceCard({ asset, amount, className = '' }: BalanceCardProps) {
  const { id, icon: Icon, symbol, decimals } = asset
  const { denomination } = useAssetDenomination()
  const priceUsd = useAssetPriceUsd(id)
  const usdValue = formatUsd(amount, decimals, priceUsd)
  const displayedSymbol = isPolicyAsset(asset) ? getPolicyAssetUnit(denomination, asset) : symbol
  const displayedAmount = isPolicyAsset(asset)
    ? formatPolicyAssetAmount(amount, denomination, asset)
    : formatAmount(amount, decimals)

  return (
    <div className={`bg-surface-secondary flex flex-col gap-1 rounded-3xl p-4 sm:p-6 ${className}`}>
      <span className='text-foreground inline-flex items-center gap-1.5 text-sm font-medium'>
        <Icon className='size-4' />
        {displayedSymbol}
      </span>
      <h3 className='text-muted text-h4'>Complete Balance {displayedSymbol}</h3>
      <div className='flex flex-col gap-1'>
        <span title={displayedAmount} className='text-foreground truncate text-xl font-semibold'>
          {displayedAmount}
        </span>
        <span title={usdValue ?? undefined} className='text-muted truncate text-xs'>
          {usdValue ?? '—'}
        </span>
      </div>
    </div>
  )
}
