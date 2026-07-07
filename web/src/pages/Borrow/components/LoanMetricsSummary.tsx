import { Tooltip } from '@heroui/react'

import CircleInfoIcon from '@/components/icons/CircleInfoIcon'
import { UiFieldLabel } from '@/components/ui/UiFieldLabel'

import { MAX_LTV } from '../helpers'

interface LoanMetricsSummaryProps {
  apr: number
  ltv: number | null
}

const APR_TOOLTIP = 'The annualized cost of the loan, based on your fee, borrowed amount, and term.'
const LTV_TOOLTIP =
  "Loan-to-value, or how much you're borrowing against your collateral's current value."
const LTV_RISK_TOOLTIP = `How close your loan is to the ${(MAX_LTV * 100).toFixed(0)}% maximum LTV. The closer to the limit, the higher the risk.`

function getLtvRisk(position: number) {
  if (position >= 2 / 3) return { label: 'High', fill: 'bg-danger' }
  if (position >= 1 / 3) return { label: 'Medium', fill: 'bg-warning' }
  return { label: 'Low', fill: 'bg-success' }
}

export default function LoanMetricsSummary({ apr, ltv }: LoanMetricsSummaryProps) {
  const exceedsMaxLtv = ltv !== null && ltv > MAX_LTV
  const position = ltv === null ? 0 : Math.min(ltv / MAX_LTV, 1)
  const risk = getLtvRisk(position)

  return (
    <div className='flex flex-col gap-1'>
      <div
        className={`bg-surface-secondary rounded-xl p-6 ${
          exceedsMaxLtv ? 'border-danger border' : ''
        }`}
      >
        <div className='flex items-center justify-between pb-3 text-sm font-medium'>
          <span className='inline-flex items-center gap-2'>
            APR
            <Tooltip delay={0}>
              <Tooltip.Trigger className='text-muted inline-flex cursor-help'>
                <CircleInfoIcon className='size-3' />
              </Tooltip.Trigger>
              <Tooltip.Content className='max-w-64 break-normal!'>{APR_TOOLTIP}</Tooltip.Content>
            </Tooltip>
          </span>
          <span>{apr.toFixed(2)}%</span>
        </div>
        <div className='border-separator border-t' />
        <div
          className={`flex items-center justify-between pt-3 text-sm font-medium ${
            exceedsMaxLtv ? 'text-danger' : ''
          }`}
        >
          <span className='inline-flex items-center gap-2'>
            LTV
            <Tooltip delay={0}>
              <Tooltip.Trigger
                className={`inline-flex cursor-help ${exceedsMaxLtv ? '' : 'text-muted'}`}
              >
                <CircleInfoIcon className='size-3' />
              </Tooltip.Trigger>
              <Tooltip.Content className='max-w-64 break-normal!'>{LTV_TOOLTIP}</Tooltip.Content>
            </Tooltip>
          </span>
          <span>{ltv === null ? '—' : `${(ltv * 100).toFixed(2)}%`}</span>
        </div>
        <div className='flex flex-col gap-1 pt-6'>
          <span className='inline-flex items-center gap-2 text-sm font-medium'>
            <UiFieldLabel required tooltip={LTV_RISK_TOOLTIP}>
              LTV Risk
            </UiFieldLabel>
          </span>
          <div className='relative mt-2 h-2'>
            <div className='bg-default h-full w-full rounded-full' />
            <div
              className={`absolute inset-y-0 left-0 rounded-full transition-[width,background-color] duration-300 ease-out ${risk.fill}`}
              style={{ width: `${position * 100}%` }}
            />
            {ltv !== null && (
              <>
                <div
                  className={`border-surface absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition-[left,background-color] duration-300 ease-out ${risk.fill}`}
                  style={{ left: `${position * 100}%` }}
                />
                <div
                  className='absolute bottom-full mb-2 -translate-x-1/2 transition-[left] duration-300 ease-out'
                  style={{ left: `${position * 100}%` }}
                >
                  <div className='bg-surface text-foreground relative rounded-lg px-2.5 py-1 text-sm font-medium shadow-md'>
                    {risk.label}
                    <div className='bg-surface absolute left-1/2 top-full size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-sm' />
                  </div>
                </div>
              </>
            )}
          </div>
          <div className='text-muted flex justify-between text-xs'>
            <span>Low</span>
            <span>Medium</span>
            <span>High ({(MAX_LTV * 100).toFixed(0)}% max)</span>
          </div>
        </div>
      </div>
      {exceedsMaxLtv && (
        <p className='text-danger text-xs'>
          LTV is higher than {(MAX_LTV * 100).toFixed(0)}%. Borrow offer is not possible to create.
        </p>
      )}
    </div>
  )
}
