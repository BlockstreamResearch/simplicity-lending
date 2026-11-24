import { NETWORK_CONFIG } from '@/constants/network-config'

const UNIT_ICON = Object.fromEntries(
  [NETWORK_CONFIG.collateralAsset, NETWORK_CONFIG.principalAsset].map(asset => [
    asset.symbol,
    asset.icon,
  ]),
)

interface AssetAmountProps {
  value: string
  unit: string
  total?: string
  isIconLeading?: boolean
}

export function AssetAmount({ value, unit, total, isIconLeading }: AssetAmountProps) {
  const Icon = UNIT_ICON[unit]
  const unitLabel = total ? `of ${total} ${unit}` : unit

  if (isIconLeading) {
    return (
      <>
        <span>
          {Icon && <Icon className='mr-2 inline size-6 align-middle' />}
          {value}
        </span>{' '}
        <span className='text-muted text-sm font-medium whitespace-nowrap'>{unitLabel}</span>
      </>
    )
  }

  return (
    <>
      {value}
      <span className='text-muted ml-1.5 inline-flex items-center gap-1 text-sm font-medium'>
        {Icon && <Icon className='size-4' />}
        {unitLabel}
      </span>
    </>
  )
}
