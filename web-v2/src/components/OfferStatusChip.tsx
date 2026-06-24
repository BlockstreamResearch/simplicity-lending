import { Chip } from '@heroui/react'

import type { OfferStatus } from '@/api/indexer/schemas'
import CircleDashedIcon from '@/components/icons/CircleDashedIcon'

type ChipColor = 'success' | 'warning' | 'accent' | 'danger' | 'default'

const OFFER_STATUS_CHIP_CONFIG: Record<OfferStatus, { color: ChipColor; label: string }> = {
  active: { color: 'success', label: 'Active' },
  pending: { color: 'warning', label: 'Pending' },
  repaid: { color: 'accent', label: 'Repaid' },
  liquidated: { color: 'danger', label: 'Liquidated' },
  cancelled: { color: 'default', label: 'Cancelled' },
  claimed: { color: 'default', label: 'Claimed' },
}

interface OfferStatusChipProps {
  status: OfferStatus
  size?: 'sm' | 'md' | 'lg'
}

export function OfferStatusChip({ status, size = 'sm' }: OfferStatusChipProps) {
  const { color, label } = OFFER_STATUS_CHIP_CONFIG[status]
  return (
    <Chip color={color} variant='soft' size={size}>
      <CircleDashedIcon className='size-3.5' />
      {label}
    </Chip>
  )
}
