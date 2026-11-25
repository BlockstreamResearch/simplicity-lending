import { Skeleton } from '@heroui/react'

import type { OfferDetails } from '@/api/indexer/schemas'
import { useAssetPriceUsd, useLiquidPricesUsd } from '@/api/prices/hooks'
import CardAlert from '@/components/CardAlert'
import TriangleExclamationIcon from '@/components/icons/TriangleExclamationIcon'
import LoanRiskChip from '@/components/LoanRiskChip'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { HIGH_RISK_LTV, MAX_LTV, MAX_LTV_BAR_POSITION, MEDIUM_RISK_LTV } from '@/constants/offers'
import { useFormatAmount } from '@/hooks/useFormatAmount'
import { DISPLAY_LOCALE, formatUsd } from '@/utils/format'
import type { ActorRole } from '@/utils/offerActions'
import {
  getLoanRiskLevel,
  getLtvBarPosition,
  getLtvThresholdPrice,
  type LoanRiskLevel,
} from '@/utils/offers'

import { getOfferLtv } from '../helpers'
import OfferMetric from './OfferMetric'

const MAX_LTV_PERCENT = Math.round(MAX_LTV * 100)

const LTV_ZONE_CONFIG = [
  { label: '0%', className: 'bg-success' },
  { label: `${Math.round(MEDIUM_RISK_LTV * 100)}%`, className: 'bg-warning' },
  { label: `${Math.round(HIGH_RISK_LTV * 100)}%`, className: 'bg-danger' },
]

const MARKER_FILL_CONFIG: Record<LoanRiskLevel, string> = {
  low: 'bg-success',
  medium: 'bg-warning',
  high: 'bg-danger',
  veryHigh: 'bg-danger',
  critical: 'bg-danger',
}

interface LoanRiskProps {
  offer: OfferDetails
  role: ActorRole
}

export default function LoanRisk({ offer, role }: LoanRiskProps) {
  const { collateralAsset, principalAsset } = NETWORK_CONFIG
  const collateralPriceUsd = useAssetPriceUsd(collateralAsset.id)
  const { isPending: isPricePending } = useLiquidPricesUsd()
  const { formatCollateralDisplay, formatPrincipalAmount } = useFormatAmount()

  const isVisible =
    offer.current_debt > 0n &&
    offer.collateral_remaining > 0n &&
    (offer.status === 'active' || offer.status === 'pending') &&
    role !== 'borrower'
  if (!isVisible) return null

  const ltv = getOfferLtv(offer, collateralPriceUsd)
  const markerLeft = `${getLtvBarPosition(ltv ?? 0)}%`
  const debtWording =
    offer.status === 'pending'
      ? { title: 'the amount to repay', body: 'to repay' }
      : { title: 'what the borrower still owes', body: 'still owed' }
  const formatPrice = (price: number | null) =>
    formatUsd(
      10n ** BigInt(collateralAsset.decimals),
      collateralAsset.decimals,
      price === null ? null : Math.round(price),
    ) ?? '—'
  const getThresholdMetric = (label: string, targetLtv: number) => {
    const thresholdPrice = getLtvThresholdPrice({
      debt: offer.current_debt,
      debtDecimals: principalAsset.decimals,
      collateral: offer.collateral_remaining,
      collateralDecimals: collateralAsset.decimals,
      ltv: targetLtv,
    })
    const caption = (() => {
      if (thresholdPrice === null || collateralPriceUsd === null) return undefined
      if (collateralPriceUsd <= thresholdPrice) return 'Already below'
      const percentBelow = Math.round((1 - thresholdPrice / collateralPriceUsd) * 100)
      return percentBelow === 0 ? '<1% below now' : `${percentBelow}% below now`
    })()
    return { label, value: formatPrice(thresholdPrice), caption }
  }

  const metrics = [
    {
      label: `${collateralAsset.symbol} Price`,
      value: isPricePending ? (
        <Skeleton className='h-7 w-24 rounded-sm' />
      ) : (
        formatPrice(collateralPriceUsd)
      ),
    },
    getThresholdMetric(`LTV Hits ${MAX_LTV_PERCENT}% At`, MAX_LTV),
    getThresholdMetric('Collateral < Debt At', 1),
  ]

  return (
    <div className='flex flex-col gap-1'>
      <div className='bg-surface flex flex-col gap-3 rounded-sm px-4 py-3'>
        <div className='flex items-center justify-between gap-3'>
          <h3 className='text-h4 text-muted'>Loan Risk</h3>
          {ltv !== null && <LoanRiskChip ltv={ltv} />}
          {ltv === null && isPricePending && <Skeleton className='h-7 w-20 rounded-full' />}
        </div>

        {ltv === null && !isPricePending && (
          <p className='text-muted text-sm'>
            Price unavailable – the risk shows once the {collateralAsset.symbol} price loads.
          </p>
        )}

        {ltv !== null && ltv >= 1 && (
          <CardAlert
            variant='danger'
            isFilled
            title={`Collateral covers only ${ltv > 100 ? '<1' : Math.floor(100 / ltv)}% of ${debtWording.title}`}
            description={`At ${formatPrice(collateralPriceUsd)} per ${collateralAsset.symbol}, the ${formatCollateralDisplay(offer.collateral_remaining)} locked is worth ${formatUsd(offer.collateral_remaining, collateralAsset.decimals, collateralPriceUsd)} against ${formatPrincipalAmount(offer.current_debt)} ${debtWording.body}.`}
          />
        )}

        <div className={`relative ${ltv === null && !isPricePending ? '' : 'pt-8'}`}>
          <div aria-hidden='true' className='bg-default flex h-2 gap-0.5 rounded-full'>
            <div className='flex gap-0.5' style={{ flexBasis: `${MAX_LTV_BAR_POSITION}%` }}>
              {LTV_ZONE_CONFIG.map(zone => (
                <span key={zone.label} className={`h-2 flex-1 rounded-full ${zone.className}`} />
              ))}
            </div>
            <span className='bg-danger-soft bg-stripes-danger h-2 flex-1 rounded-full' />
          </div>
          {ltv !== null && (
            <>
              <div className='absolute -inset-x-2 top-0'>
                <div
                  className={`bg-overlay absolute top-0 flex items-center gap-1 rounded-xl px-2 py-1 text-xs whitespace-nowrap drop-shadow-md ${ltv >= 1 ? 'text-danger' : ''}`}
                  style={{ left: markerLeft, translate: `-${markerLeft}` }}
                >
                  {ltv >= 1 && <TriangleExclamationIcon className='size-4' />}
                  LTV {Math.floor(ltv * 100).toLocaleString(DISPLAY_LOCALE)}%
                </div>
              </div>
              <div className='absolute inset-x-1.75 inset-y-0'>
                <span
                  className='bg-overlay absolute top-6 size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-xs'
                  style={{ left: markerLeft }}
                />
                <span
                  className={`border-surface absolute top-9 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-md ${MARKER_FILL_CONFIG[getLoanRiskLevel(ltv)]}`}
                  style={{ left: markerLeft }}
                />
              </div>
            </>
          )}
        </div>

        <div className='grid grid-cols-5 text-xs whitespace-nowrap'>
          {LTV_ZONE_CONFIG.map(zone => (
            <span key={zone.label} className='text-muted'>
              {zone.label}
            </span>
          ))}
          <span className='text-muted'>
            {MAX_LTV_PERCENT}%<span className='hidden sm:inline'> (MAX)</span>
          </span>
          <span className='text-danger text-right'>
            <span className='sm:hidden'>&gt;100%</span>
            <span className='hidden sm:inline'>More than 100%</span>
          </span>
        </div>
      </div>

      <div className='bg-surface grid gap-4 rounded-sm px-4 py-3 sm:grid-cols-3'>
        {metrics.map(metric => (
          <OfferMetric key={metric.label} size='compact' {...metric} />
        ))}
      </div>
    </div>
  )
}
