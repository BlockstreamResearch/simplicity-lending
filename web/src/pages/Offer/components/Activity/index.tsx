import { Spinner } from '@heroui/react'
import { type ReactNode, useState } from 'react'

import { useBlockHeight } from '@/api/esplora/hooks'
import type { OfferDetails } from '@/api/indexer/schemas'
import ChevronRightIcon from '@/components/icons/ChevronRightIcon'
import ListIcon from '@/components/icons/ListIcon'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useFormatAmount } from '@/hooks/useFormatAmount'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import type { ActorRole } from '@/utils/offerActions'

import { formatBlocksAgo } from '../../helpers'
import ActivityEventHeader from './ActivityEventHeader'
import ActivityEventModal from './ActivityEventModal'
import { ACTIVITY_EVENT_CONFIG } from './constants'
import {
  type ActivityAmount,
  getOfferActivity,
  getPendingActivity,
  type OfferActivityEvent,
  type OfferPendingTxKind,
} from './helpers'

const PENDING_TITLE: Record<OfferPendingTxKind, string> = {
  accept_offer: 'Accepting',
  cancel_offer: 'Cancelling',
  claim_principal: 'Claiming Principal',
  repay_offer: 'Repaying',
  claim_interest: 'Withdrawing',
  withdraw_part: 'Withdrawing',
  liquidate_offer: 'Liquidating',
}

interface ActivityRowProps {
  title: string
  icon: ReactNode
  tone: string
  caption: string
  amount: ActivityAmount
  time?: string
  hasTimeline: boolean
  onPress?: () => void
}

function ActivityRow({
  title,
  icon,
  tone,
  caption,
  amount,
  time,
  hasTimeline,
  onPress,
}: ActivityRowProps) {
  const { formatCollateralDisplay, formatPrincipalAmount } = useFormatAmount()
  const isCollateral = amount.asset === 'collateral'
  const { icon: AssetIcon } = isCollateral
    ? NETWORK_CONFIG.collateralAsset
    : NETWORK_CONFIG.principalAsset
  const className = `bg-surface relative flex min-h-9 w-full flex-col gap-1 rounded-sm px-4 py-3 text-left sm:flex-row sm:items-center sm:justify-between sm:gap-3 ${
    hasTimeline
      ? 'sm:before:bg-separator sm:before:absolute sm:before:-top-3 sm:before:left-8.5 sm:before:h-3 sm:before:w-px sm:before:-translate-x-1/2'
      : ''
  }`

  const content = (
    <>
      <ActivityEventHeader title={title} icon={icon} tone={tone} caption={caption} />
      <span className='flex items-center justify-between gap-3 pl-12 sm:shrink-0 sm:justify-end sm:pl-0'>
        <span className='flex min-w-0 flex-wrap items-center gap-x-2 sm:flex-col sm:items-end'>
          <span className='text-foreground flex items-center gap-1.5 text-sm font-medium'>
            <AssetIcon className='size-4 shrink-0' />
            {isCollateral
              ? formatCollateralDisplay(amount.value)
              : formatPrincipalAmount(amount.value)}
          </span>
          {time && <span className='text-muted text-xs whitespace-nowrap'>{time}</span>}
        </span>
        <ChevronRightIcon className={`text-muted size-4 shrink-0 ${onPress ? '' : 'invisible'}`} />
      </span>
    </>
  )

  return (
    <li>
      {onPress ? (
        <button
          type='button'
          onClick={onPress}
          className={`${className} hover:bg-table-row-hover focus-visible:bg-table-row-hover active:bg-accent-soft focus-visible:shadow-focus-ring cursor-pointer transition-colors outline-none`}
        >
          {content}
        </button>
      ) : (
        <div className={className}>{content}</div>
      )}
    </li>
  )
}

interface OfferActivityProps {
  offer: OfferDetails
  role: ActorRole
}

export default function OfferActivity({ offer, role }: OfferActivityProps) {
  const { pendingTxs } = usePendingTransactions()
  const { data: currentBlockHeight } = useBlockHeight()
  const { formatCollateralDisplay, formatPrincipalAmount } = useFormatAmount()
  const [selectedEvent, setSelectedEvent] = useState<OfferActivityEvent | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  const events = getOfferActivity(offer)
  const pendingEvents = getPendingActivity(offer, events, pendingTxs)

  const getCaption = (event: OfferActivityEvent): string => {
    switch (event.type) {
      case 'created':
        return 'Borrower deposited and locked the collateral'
      case 'accepted':
        return `Lender supplied ${formatPrincipalAmount(event.amount.value)} in principal`
      case 'principal-claimed':
        return `Borrower claimed the ${formatPrincipalAmount(event.amount.value)} principal`
      case 'partial-repayment':
        return `${formatPrincipalAmount(event.repayment.debt_after)} debt remaining · ${formatCollateralDisplay(event.repayment.collateral_unlocked)} collateral returned to the borrower`
      case 'full-repayment':
        return `Debt fully repaid · ${formatCollateralDisplay(event.repayment.collateral_unlocked)} collateral returned to the borrower`
      case 'partial-withdrawal':
      case 'full-withdrawal':
        return `${formatPrincipalAmount(event.withdrawal.vault_amount_after)} remaining in the lender's vault`
      case 'cancelled':
        return 'Collateral returned to the borrower'
      case 'liquidated':
        return 'Collateral transferred to the lender'
    }
  }

  return (
    <section className='bg-surface-secondary flex min-w-0 flex-col gap-6 rounded-3xl p-4 sm:p-6 lg:col-span-2'>
      <div className='flex items-center gap-3'>
        <ListIcon className='size-6' />
        <h3 className='text-h4'>Activity</h3>
      </div>

      <ol className='flex flex-col gap-3'>
        {events.map((event, index) => {
          const { title, Icon, tone } = ACTIVITY_EVENT_CONFIG[event.type]
          return (
            <ActivityRow
              key={`${event.type}-${event.txid}`}
              title={title}
              icon={<Icon className='size-4' />}
              tone={tone}
              caption={getCaption(event)}
              amount={event.amount}
              time={formatBlocksAgo(currentBlockHeight, event.height) ?? '–'}
              hasTimeline={index > 0}
              onPress={() => {
                setSelectedEvent(event)
                setIsModalOpen(true)
              }}
            />
          )
        })}
        {pendingEvents.map(pending => (
          <ActivityRow
            key={pending.txid}
            title={PENDING_TITLE[pending.kind]}
            icon={<Spinner size='sm' color='current' className='size-4' />}
            tone='bg-surface-tertiary text-foreground'
            caption={
              pending.isConfirmed ? 'Confirmed, updating the offer…' : 'Waiting for confirmation…'
            }
            amount={pending.amount}
            hasTimeline
          />
        ))}
      </ol>

      {selectedEvent && (
        <ActivityEventModal
          offer={offer}
          role={role}
          event={selectedEvent}
          isOpen={isModalOpen}
          onOpenChange={setIsModalOpen}
        />
      )}
    </section>
  )
}
