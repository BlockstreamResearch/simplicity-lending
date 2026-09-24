import { NETWORK_CONFIG } from '@/constants/network-config'

const UNIT_ICON = Object.fromEntries(
  [NETWORK_CONFIG.collateralAsset, NETWORK_CONFIG.principalAsset].map(asset => [
    asset.symbol,
    asset.icon,
  ]),
)

export function AssetAmount({ value, unit }: { value: string; unit: string }) {
  const Icon = UNIT_ICON[unit]
  return (
    <>
      {value}
      <span className='text-muted ml-1.5 inline-flex items-center gap-1 text-sm font-medium'>
        {Icon && <Icon className='size-4' />}
        {unit}
      </span>
    </>
  )
}
