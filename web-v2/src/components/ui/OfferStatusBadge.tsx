import { Chip } from '@heroui/react'

import type { OfferStatus } from '@/api/indexer/schemas'
import CircleDashedIcon from '@/components/icons/CircleDashedIcon'

export type DisplayStatus = OfferStatus | 'expired'

type ChipColor = 'success' | 'warning' | 'accent' | 'danger' | 'default'

const STATUS_CHIP: Record<DisplayStatus, { color: ChipColor; label: string }> = {
  active: { color: 'success', label: 'Active' },
  pending: { color: 'warning', label: 'Pending' },
  repaid: { color: 'accent', label: 'Repaid' },
  liquidated: { color: 'danger', label: 'Liquidated' },
  cancelled: { color: 'default', label: 'Cancelled' },
  claimed: { color: 'default', label: 'Claimed' },
  unknown: { color: 'default', label: 'Unknown' },
  expired: { color: 'default', label: 'Expired' },
}

export function OfferStatusBadge({ status }: { status: DisplayStatus }) {
  const { color, label } = STATUS_CHIP[status]
  return (
    <Chip color={color} variant='soft' size='sm'>
      <CircleDashedIcon className='size-3.5' />
      {label}
    </Chip>
  )
}
