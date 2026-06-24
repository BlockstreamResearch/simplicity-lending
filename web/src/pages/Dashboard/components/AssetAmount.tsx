import type { ReactNode } from 'react'

import LbtcIcon from '@/components/icons/LbtcIcon'
import UsdtIcon from '@/components/icons/UsdtIcon'

const UNIT_LOGO: Record<string, ReactNode> = {
  LBTC: <LbtcIcon className='size-4' />,
  USDT: <UsdtIcon className='size-4' />,
}

export function AssetAmount({ value, unit }: { value: string; unit: string }) {
  return (
    <>
      {value}
      <span className='text-muted ml-1.5 inline-flex items-center gap-1 text-sm font-medium'>
        {UNIT_LOGO[unit]}
        {unit}
      </span>
    </>
  )
}
