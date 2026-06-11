import { type ConfigAsset } from '@/constants/network-config'
import { formatAmount } from '@/utils/format'

interface BalanceCardProps {
  asset: ConfigAsset
  amount: bigint
  className?: string
}

export default function BalanceCard({ asset, amount, className = '' }: BalanceCardProps) {
  const { icon: Icon, symbol, decimals } = asset

  return (
    <div className={`flex flex-col gap-3 rounded-3xl p-6 ${className}`}>
      <span className='text-foreground inline-flex items-center gap-1.5 text-sm font-medium'>
        <Icon className='size-4' />
        {symbol}
      </span>
      <h3 className='text-muted text-h4'>Complete Balance {symbol}</h3>
      <div className='flex flex-col gap-1.5'>
        <span className='text-foreground text-display'>{formatAmount(amount, decimals)}</span>
        <span className='text-muted text-xs'>—</span>
      </div>
    </div>
  )
}
