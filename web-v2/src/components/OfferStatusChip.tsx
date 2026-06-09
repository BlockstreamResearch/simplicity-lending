import { Chip } from '@heroui/react'

import CircleDashedIcon from '@/components/icons/CircleDashedIcon'
import type { OfferDisplayStatus } from '@/utils/offers'

type ChipColor = 'success' | 'warning' | 'accent' | 'danger' | 'default'

const OFFER_STATUS_CHIP_CONFIG: Record<OfferDisplayStatus, { color: ChipColor; label: string }> = {
  active: { color: 'success', label: 'Active' },
  pending: { color: 'warning', label: 'Pending' },
  repaid: { color: 'accent', label: 'Repaid' },
  liquidated: { color: 'danger', label: 'Liquidated' },
  // TODO: distinct colors once design provides them.
  cancelled: { color: 'default', label: 'Cancelled' },
  claimed: { color: 'default', label: 'Claimed' },
  unknown: { color: 'default', label: 'Unknown' },
  expired: { color: 'default', label: 'Expired' },
}

export function OfferStatusChip({ status }: { status: OfferDisplayStatus }) {
  const { color, label } = OFFER_STATUS_CHIP_CONFIG[status]
  return (
    <Chip color={color} variant='soft' size='sm'>
      <CircleDashedIcon className='size-3.5' />
      {label}
    </Chip>
  )
}
