import { useAssetPriceUsd } from '@/api/prices/hooks'
import PendingBalanceBadge from '@/components/PendingBalanceBadge'
import { type ConfigAsset } from '@/constants/network-config'
import { useAssetDenomination } from '@/providers/assetDenomination/useAssetDenomination'
import { formatAmount, formatUsd } from '@/utils/format'
import {
  formatPolicyAssetAmount,
  getAssetUnit,
  isPolicyAsset,
} from '@/utils/policyAssetDenomination'

interface BalanceCardProps {
  asset: ConfigAsset
  amount: bigint
  pendingAmount?: bigint
  /**
   * Why this balance is not known, when it is not.
   *
   * An amount of zero is a fact about the account. A balance the wallet did not answer is a fact
   * about the wallet, and rendering it as zero states the first when only the second is true —
   * which is how a refused read reads as "you hold nothing" and hides itself.
   */
  unavailableReason?: string | null
  className?: string
}

export default function BalanceCard({
  asset,
  amount,
  pendingAmount,
  unavailableReason,
  className = '',
}: BalanceCardProps) {
  const { id, icon: Icon, decimals } = asset
  const { denomination } = useAssetDenomination()
  const priceUsd = useAssetPriceUsd(id)
  const usdValue = formatUsd(amount, decimals, priceUsd)
  const displayedSymbol = getAssetUnit(denomination, asset)
  const formatAssetAmount = (value: bigint) =>
    isPolicyAsset(asset)
      ? formatPolicyAssetAmount(value, denomination, asset)
      : formatAmount(value, decimals)
  const displayedAmount = formatAssetAmount(amount)
  const hasPending = pendingAmount !== undefined && pendingAmount > 0n

  return (
    <div className={`bg-surface-secondary flex flex-col gap-1 rounded-3xl p-4 sm:p-6 ${className}`}>
      <span className='text-foreground inline-flex items-center gap-1.5 text-sm font-medium'>
        <Icon className='size-4' />
        {displayedSymbol}
      </span>
      <h3 className='text-muted text-h4'>Available Amount</h3>
      <div className='flex flex-col gap-1'>
        {unavailableReason ? (
          <span title={unavailableReason} className='text-danger text-sm font-medium'>
            Not known
          </span>
        ) : (
          <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
            <span
              title={displayedAmount}
              className='text-foreground min-w-0 truncate text-xl font-semibold'
            >
              {displayedAmount}
            </span>
            {hasPending && (
              <PendingBalanceBadge
                label={formatAssetAmount(pendingAmount)}
                tooltip={`${formatAssetAmount(pendingAmount)} ${displayedSymbol} is unconfirmed and on the way. It will be spendable once the transaction confirms.`}
              />
            )}
          </div>
        )}
        <span
          title={unavailableReason ?? usdValue ?? undefined}
          className='text-muted truncate text-xs'
        >
          {unavailableReason ?? usdValue ?? '—'}
        </span>
      </div>
    </div>
  )
}
