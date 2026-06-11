import CircleInfoIcon from '@/components/icons/CircleInfoIcon'

import { MAX_LTV } from '../helpers'

interface LoanInfoProps {
  apr: number
  ltv: number | null
}

export default function LoanInfo({ apr, ltv }: LoanInfoProps) {
  const exceedsMaxLtv = ltv !== null && ltv > MAX_LTV

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
            <CircleInfoIcon className='text-muted size-3' />
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
            <CircleInfoIcon className={`size-3 ${exceedsMaxLtv ? '' : 'text-muted'}`} />
          </span>
          <span>{ltv === null ? '—' : `${(ltv * 100).toFixed(2)}%`}</span>
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
