import type { OfferStatus } from '../types/offers'
import { getOfferStatusUi } from '../utility/offerStatusUi'

export interface OfferStatusBadgeProps {
  status: OfferStatus | string
  loanExpirationTime?: number
  currentBlockHeight?: number | null
  className?: string
}

export function OfferStatusBadge({
  status,
  loanExpirationTime,
  currentBlockHeight,
  className,
}: OfferStatusBadgeProps) {
  const ui = getOfferStatusUi({
    status,
    loanExpirationTime,
    currentBlockHeight,
  })

  return (
    <span
      className={[
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-sm font-medium',
        ui.chipClassName,
        ui.textClassName,
        className ?? '',
      ]
        .join(' ')
        .trim()}
    >
      <span
        className={['h-2.5 w-2.5 shrink-0 rounded-full', ui.dotClassName].join(' ')}
        aria-hidden="true"
      />
      <span>{ui.label}</span>
    </span>
  )
}
