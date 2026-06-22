import { useAssetPriceUsd } from '@/api/prices/hooks'
import { type ConfigAsset } from '@/constants/network-config'
import { formatAmount, formatUsd } from '@/utils/format'

interface BalanceCardProps {
  asset: ConfigAsset
  amount: bigint
  className?: string
}

export default function BalanceCard({ asset, amount, className = '' }: BalanceCardProps) {
  const { id, icon: Icon, symbol, decimals } = asset
  const priceUsd = useAssetPriceUsd(id)
  const usdValue = formatUsd(amount, decimals, priceUsd)

  return (
    <div className={`bg-surface-secondary flex flex-col gap-1 rounded-3xl p-6 ${className}`}>
      <span className='text-foreground inline-flex items-center gap-1.5 text-sm font-medium'>
        <Icon className='size-4' />
        {symbol}
      </span>
      <h3 className='text-muted text-h4'>Complete Balance {symbol}</h3>
      <div className='flex flex-col gap-1'>
        <span className='text-foreground text-xl font-semibold'>
          {formatAmount(amount, decimals)}
        </span>
        <span className='text-muted text-xs'>{usdValue ?? '—'}</span>
      </div>
    </div>
  )
}
