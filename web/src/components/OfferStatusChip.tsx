import { Chip, Spinner } from '@heroui/react'

import type { OfferStatus } from '@/api/indexer/schemas'

type ChipColor = 'success' | 'warning' | 'accent' | 'danger' | 'default'

const OFFER_STATUS_CHIP_CONFIG: Record<OfferStatus, { color: ChipColor; label: string }> = {
  active: { color: 'success', label: 'Active' },
  pending: { color: 'warning', label: 'Open Offer' },
  repaid: { color: 'accent', label: 'Repaid' },
  liquidated: { color: 'danger', label: 'Liquidated' },
  cancelled: { color: 'default', label: 'Cancelled' },
  claimed: { color: 'default', label: 'Claimed' },
}

interface OfferStatusChipProps {
  status: OfferStatus
  size?: 'sm' | 'md' | 'lg'
  isProcessing?: boolean
}

export function OfferStatusChip({ status, size = 'sm', isProcessing }: OfferStatusChipProps) {
  if (isProcessing) {
    return (
      <Chip color='default' variant='soft' size={size}>
        <Spinner size='sm' color='current' className='mr-1 size-3' />
        Processing...
      </Chip>
    )
  }
  const { color, label } = OFFER_STATUS_CHIP_CONFIG[status]
  return (
    <Chip color={color} variant='soft' size={size}>
      <span className='mr-1 size-1.5 shrink-0 rounded-full bg-current' aria-hidden='true' />
      {label}
    </Chip>
  )
}
