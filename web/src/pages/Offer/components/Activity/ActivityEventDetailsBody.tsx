import { buttonVariants, Tooltip } from '@heroui/react'

import { getBlockExplorerUrl, getTxExplorerUrl } from '@/api/esplora/utils'
import type { OfferDetails, ParticipantType } from '@/api/indexer/schemas'
import CopyButton from '@/components/CopyButton'
import DetailsPanel, { type DetailRow } from '@/components/DetailsPanel'
import ArrowUpRightIcon from '@/components/icons/ArrowUpRightIcon'
import CircleInfoIcon from '@/components/icons/CircleInfoIcon'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { PROTOCOL_FEE_LABEL, PROTOCOL_FEE_TOOLTIP } from '@/constants/offers'
import { useBlockDate } from '@/hooks/useBlockDate'
import { useFormatAmount } from '@/hooks/useFormatAmount'
import {
  DISPLAY_LOCALE,
  formatAmount,
  formatDateTime,
  scriptPubkeyToAddress,
  truncateAddress,
} from '@/utils/format'
import type { ActorRole } from '@/utils/offerActions'
import { bpsToPercent, calcInterest, computeProtocolFee } from '@/utils/offers'

import { getLenderNetInterest } from '../../helpers'
import { ACTIVITY_EVENT_CONFIG, ACTOR_LABEL } from './constants'
import type { OfferActivityEvent } from './helpers'

interface EventDetailsView {
  heroLabel: string
  heroTooltip?: string
  offerRows: DetailRow[]
  wallet?: { participant: ParticipantType; action: string }
}

function ExplorerLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target='_blank'
      rel='noopener noreferrer'
      aria-label={label}
      className={buttonVariants({ variant: 'tertiary', size: 'sm', isIconOnly: true })}
    >
      <ArrowUpRightIcon className='size-4' />
    </a>
  )
}

interface ActivityEventDetailsBodyProps {
  offer: OfferDetails
  role: ActorRole
  event: OfferActivityEvent
}

export default function ActivityEventDetailsBody({
  offer,
  role,
  event,
}: ActivityEventDetailsBodyProps) {
  const { collateralUnit, formatCollateralAmount, formatCollateralDisplay, formatPrincipalAmount } =
    useFormatAmount()
  const deadlineDate = useBlockDate(offer.loan_expiration_height, offer.created_at_height)
  const { collateralAsset, principalAsset } = NETWORK_CONFIG

  const formatPrincipal = (amount: bigint) => formatAmount(amount, principalAsset.decimals)
  const interest = calcInterest(offer.principal_amount, offer.interest_rate)
  const totalDebt = offer.principal_amount + interest
  const deadlineRow: DetailRow = {
    label: 'Repayment Deadline',
    value: deadlineDate ? formatDateTime(deadlineDate) : '–',
  }

  const renderChange = (before: string, after: string) => (
    <>
      <span className='text-muted line-through'>{before}</span>
      <span className='text-muted'>→</span>
      {after}
    </>
  )
  const renderWithCaption = (value: string, caption: string) => (
    <span className='flex flex-col items-end text-right'>
      {value}
      <span className='text-muted text-xs font-normal'>{caption}</span>
    </span>
  )

  const details: EventDetailsView = (() => {
    switch (event.type) {
      case 'created': {
        const protocolFee = computeProtocolFee(interest)
        return {
          heroLabel: 'Collateral Locked',
          offerRows: [
            { label: 'Borrower Asks For', value: formatPrincipalAmount(offer.principal_amount) },
            {
              label: 'Interest',
              value: renderWithCaption(
                `${formatPrincipalAmount(interest)} (${bpsToPercent(offer.interest_rate)} of ${formatPrincipalAmount(offer.principal_amount)})`,
                `${formatPrincipalAmount(getLenderNetInterest(offer))} to lender, ${formatPrincipalAmount(protocolFee)} protocol fee`,
              ),
            },
            {
              label: PROTOCOL_FEE_LABEL,
              tooltip: PROTOCOL_FEE_TOOLTIP,
              multilineTooltip: true,
              value: formatPrincipalAmount(protocolFee),
            },
            deadlineRow,
          ],
          wallet: { participant: 'borrower', action: 'Deposited from' },
        }
      }
      case 'accepted':
        return {
          heroLabel: 'Principal Supplied',
          heroTooltip: `After acceptance, the borrower still has to claim the ${principalAsset.symbol} from the contract.`,
          offerRows: [
            {
              label: 'Debt',
              value: renderWithCaption(
                formatPrincipalAmount(totalDebt),
                `${formatPrincipalAmount(offer.principal_amount)} principal + ${formatPrincipalAmount(interest)} interest`,
              ),
            },
          ],
          wallet: { participant: 'lender', action: 'Funded from' },
        }
      case 'principal-claimed':
        return {
          heroLabel: 'Principal Claimed',
          offerRows: [],
          wallet: { participant: 'borrower', action: 'Sent to' },
        }
      case 'partial-repayment':
      case 'full-repayment': {
        const { repayment } = event
        return {
          heroLabel: ACTIVITY_EVENT_CONFIG[event.type].title,
          // TODO: add "To Lender's Vault" and "Protocol Fee" rows from the indexer's repayment split once the API exposes it
          offerRows: [
            {
              label: 'Debt',
              value: renderChange(
                formatPrincipal(repayment.debt_before),
                formatPrincipalAmount(repayment.debt_after),
              ),
            },
            {
              label: 'Collateral Locked',
              value: renderChange(
                formatCollateralAmount(repayment.collateral_before),
                formatCollateralDisplay(repayment.collateral_after),
              ),
            },
            {
              label: role === 'borrower' ? 'Returned to You' : 'Returned to Borrower',
              value: formatCollateralDisplay(repayment.collateral_unlocked),
            },
          ],
        }
      }
      case 'partial-withdrawal':
      case 'full-withdrawal':
        return {
          heroLabel: ACTIVITY_EVENT_CONFIG[event.type].title,
          offerRows: [
            {
              label: "Lender's Vault Balance",
              value: renderChange(
                formatPrincipal(event.withdrawal.vault_amount_before),
                formatPrincipalAmount(event.withdrawal.vault_amount_after),
              ),
            },
          ],
          wallet: { participant: 'lender', action: 'Sent to' },
        }
      case 'cancelled':
        return {
          heroLabel: 'Collateral Returned',
          offerRows: [],
          wallet: { participant: 'borrower', action: 'Sent to' },
        }
      case 'liquidated': {
        const repaid = offer.repayments.reduce(
          (sum, repayment) => sum + repayment.amount_repaid,
          0n,
        )
        return {
          heroLabel: 'Collateral Liquidated',
          offerRows: [
            {
              label: 'Unpaid Debt',
              value: (
                <span className='text-danger'>{formatPrincipalAmount(totalDebt - repaid)}</span>
              ),
            },
            deadlineRow,
          ],
        }
      }
    }
  })()

  const { wallet } = details
  // TODO: replace participant addresses with the indexer's per-event recipient/funder field once the API exposes it
  const walletScriptPubkey = offer.participants.find(
    participant => participant.participant_type === wallet?.participant,
  )?.script_pubkey
  const walletAddress = walletScriptPubkey && scriptPubkeyToAddress(walletScriptPubkey)

  const onChainRows: DetailRow[] = [
    ...(wallet && walletAddress
      ? [
          {
            label: `${wallet.action} ${role === wallet.participant ? 'Your Wallet' : `the ${ACTOR_LABEL[wallet.participant]}'s Wallet`}`,
            value: (
              <>
                {truncateAddress(walletAddress)}
                <CopyButton value={walletAddress} variant='tertiary' aria-label='Copy address' />
              </>
            ),
          },
        ]
      : []),
    {
      label: 'Transaction',
      value: (
        <>
          {truncateAddress(event.txid)}
          <CopyButton value={event.txid} variant='tertiary' aria-label='Copy transaction ID' />
          <ExplorerLink href={getTxExplorerUrl(event.txid)} label='Open transaction in explorer' />
        </>
      ),
    },
    {
      label: 'Block',
      value: (
        <>
          {event.height.toLocaleString(DISPLAY_LOCALE)}
          <ExplorerLink href={getBlockExplorerUrl(event.height)} label='Open block in explorer' />
        </>
      ),
    },
  ]

  const isCollateral = event.amount.asset === 'collateral'
  const { icon: AssetIcon } = isCollateral ? collateralAsset : principalAsset

  return (
    <div className='text-foreground flex flex-col gap-8'>
      <section className='bg-surface-secondary flex flex-col gap-3 rounded-xl p-6'>
        <span className='text-h4 text-muted inline-flex items-center gap-1.5'>
          {details.heroLabel}
          {details.heroTooltip && (
            <Tooltip delay={0}>
              <Tooltip.Trigger className='inline-flex shrink-0 cursor-help'>
                <CircleInfoIcon className='size-4' />
              </Tooltip.Trigger>
              <Tooltip.Content className='text-muted max-w-64 break-normal!'>
                {details.heroTooltip}
              </Tooltip.Content>
            </Tooltip>
          )}
        </span>
        <p className='flex items-center gap-2'>
          <AssetIcon className='size-6 shrink-0' />
          <span className='text-display break-all'>
            {isCollateral
              ? formatCollateralAmount(event.amount.value)
              : formatPrincipal(event.amount.value)}
          </span>
          <span className='text-muted self-end pb-0.5 text-sm font-medium'>
            {isCollateral ? collateralUnit : principalAsset.symbol}
          </span>
        </p>
      </section>
      {details.offerRows.length > 0 && (
        <DetailsPanel title='Offer Details' rows={details.offerRows} />
      )}
      <DetailsPanel title='On-Chain' rows={onChainRows} />
    </div>
  )
}
