import { buttonVariants } from '@heroui/react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import LbtcIcon from '@/components/icons/LbtcIcon'
import TriangleExclamationIcon from '@/components/icons/TriangleExclamationIcon'
import { UiFieldLabel } from '@/components/ui/UiFieldLabel'
import { UiSelect } from '@/components/ui/UiSelect'
import { UiTextField } from '@/components/ui/UiTextField'
import { PROTOCOL_FEE_BPS } from '@/constants/offers'
import { RoutePath } from '@/constants/routes'
import LoanMetricsSummary from '@/pages/Borrow/components/LoanMetricsSummary'

const TICK_INTERVAL_MS = 3000
const COLLATERAL_LBTC = 1
const TERM_OPTIONS = [{ id: 1, textValue: '1 Month' }]

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min)
}

function generateTick() {
  const priceUsd = randomBetween(76000, 82000)
  const balance = 10 + randomBetween(-0.02, 0.02)
  const ltv = randomBetween(0.35, 0.5)
  const loanAmount = Math.round((priceUsd * COLLATERAL_LBTC * ltv) / 100) * 100
  const apr = randomBetween(7.5, 10.5)
  const fee = Math.round((loanAmount * (apr / 100)) / 12)
  const protocolFee = Math.round((fee * PROTOCOL_FEE_BPS) / 10000)
  return { priceUsd, balance, ltv, loanAmount, apr, fee, protocolFee }
}

export function LiveCreateOfferPreview() {
  const [tick, setTick] = useState(generateTick)

  useEffect(() => {
    const id = window.setInterval(() => setTick(generateTick()), TICK_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div className='bg-surface w-[550px] rounded-3xl border border-[#ebebec] p-5 shadow-[0px_2px_8px_0px_rgba(0,0,0,0.06),0px_-6px_12px_0px_rgba(0,0,0,0.03),0px_14px_28px_0px_rgba(0,0,0,0.08)] sm:p-6'>
      <p className='text-foreground mb-5 text-lg font-bold'>Create Borrow Offer</p>

      <div className='flex flex-col gap-5'>
        <div className='bg-surface-secondary flex flex-col gap-1 rounded-3xl p-4 sm:p-6'>
          <span className='text-foreground inline-flex items-center gap-1.5 text-sm font-medium'>
            <LbtcIcon className='size-4' />
            LBTC
          </span>
          <h3 className='text-muted text-h4'>Available Amount</h3>
          <span className='text-foreground text-xl font-semibold'>{tick.balance.toFixed(5)}</span>
          <span className='text-muted text-xs'>
            $
            {(tick.balance * tick.priceUsd).toLocaleString('en-US', {
              maximumFractionDigits: 2,
            })}{' '}
            USD
          </span>
        </div>

        <UiTextField
          label={
            <UiFieldLabel required tooltip='The LBTC you lock to back the loan.'>
              Collateral to Lock
            </UiFieldLabel>
          }
          value={String(COLLATERAL_LBTC)}
          isReadOnly
          endContent='LBTC'
          onMax={() => {}}
          isMaxDisabled
          description={`Collateral Value = $${(tick.priceUsd * COLLATERAL_LBTC).toLocaleString('en-US', { maximumFractionDigits: 2 })} USD`}
        />

        <UiTextField
          label={
            <UiFieldLabel required tooltip='The amount you want to borrow in USDT.'>
              Loan Amount
            </UiFieldLabel>
          }
          value={tick.loanAmount.toLocaleString('en-US')}
          isReadOnly
          endContent='USDT'
        />

        <div className='flex flex-col gap-5 sm:flex-row'>
          <div className='flex-1'>
            <UiTextField
              label={
                <UiFieldLabel required tooltip='The interest you pay the lender, in USDT.'>
                  Fee
                </UiFieldLabel>
              }
              value={String(tick.fee)}
              isReadOnly
              endContent='USDT'
            />
          </div>
          <div className='flex-1'>
            <UiSelect
              label={
                <UiFieldLabel required tooltip='How long the loan runs.'>
                  Term
                </UiFieldLabel>
              }
              options={TERM_OPTIONS}
              selectedKey={1}
              isDisabled
            />
          </div>
        </div>

        <LoanMetricsSummary
          protocolFee={`${tick.protocolFee} USDT`}
          apr={tick.apr}
          ltv={tick.ltv}
        />

        <div className='border-warning bg-warning/15 text-muted flex items-center gap-3 rounded-xl border-2 p-3 text-sm font-medium'>
          <TriangleExclamationIcon className='text-warning size-6 shrink-0' />
          Your collateral will be locked until the offer is repaid or cancelled.
        </div>

        <Link to={RoutePath.Borrow} className={buttonVariants({ variant: 'primary' })}>
          Create Borrow Offer
        </Link>
      </div>
    </div>
  )
}
