import type { ReactNode } from 'react'

import InfoTooltip from '@/components/InfoTooltip'

const OFFER_METRIC_SIZE_CONFIG = {
  large: { gap: 'gap-3', captionGap: 'gap-1.5', value: 'text-h2' },
  compact: { gap: 'gap-1', captionGap: 'gap-1', value: 'text-xl font-bold' },
} as const

export interface OfferMetricProps {
  label: string
  tooltip?: string
  value: ReactNode
  caption?: string
  size?: keyof typeof OFFER_METRIC_SIZE_CONFIG
}

export default function OfferMetric({
  label,
  value,
  caption,
  tooltip,
  size = 'large',
}: OfferMetricProps) {
  const sizeConfig = OFFER_METRIC_SIZE_CONFIG[size]
  return (
    <div className={`flex min-w-0 flex-col ${sizeConfig.gap}`}>
      <span className='text-h4 text-muted inline-flex items-center gap-1.5'>
        {label}
        {tooltip && <InfoTooltip content={tooltip} iconClassName='size-4' />}
      </span>
      <div className={`flex flex-col ${sizeConfig.captionGap}`}>
        <div className={`wrap-break-word ${sizeConfig.value}`}>{value}</div>
        {caption && <span className='text-muted text-xs'>{caption}</span>}
      </div>
    </div>
  )
}
