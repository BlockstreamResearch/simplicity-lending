import { Skeleton } from '@heroui/react'
import { type ReactNode, useCallback, useState } from 'react'

import { useBlockHeight } from '@/api/esplora/hooks'
import type { OfferDetails } from '@/api/indexer/schemas'
import { useAssetPriceUsd } from '@/api/prices/hooks'
import { AssetAmount } from '@/components/AssetAmount'
import OfferActionModal from '@/components/modals/OfferActionModal'
import { UiButton, type UiButtonProps } from '@/components/ui/UiButton'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useBlockDate } from '@/hooks/useBlockDate'
import { useFormatAmount } from '@/hooks/useFormatAmount'
import { useWallet } from '@/providers/wallet/useWallet'
import {
  formatAmount,
  formatBlocksDuration,
  formatDateTime,
  formatUsd,
  splitBlocksDuration,
} from '@/utils/format'
import { type ActorRole, type OfferAction, resolveOfferAction } from '@/utils/offerActions'
import { getOfferTermLeft } from '@/utils/offers'

import {
  formatLoanTerm,
  getFullRepaymentHeight,
  getLenderPayout,
  getLenderVaultBalance,
  getLiquidatedCollateral,
  getLoanDurationBlocks,
  getRepaidToLender,
  getUtxoCreatedHeight,
} from '../helpers'

type ActionWithButton = Exclude<OfferAction, 'none'>
const ACTION_BUTTON_VARIANT: Record<ActionWithButton, UiButtonProps['variant']> = {
  accept: 'primary',
  cancel: 'danger-soft',
  repay: 'primary',
  'claim-principal': 'primary',
  'claim-interest': 'primary',
  liquidate: 'danger',
}

interface DeadlineView {
  title: string
  subtitle: string
  countdownBlocks?: number
  summary?: string
}

interface ContentView {
  title: string
  amount?: ReactNode
  description?: string
}

function Countdown({ blocks }: { blocks: number }) {
  const { days, hours, minutes } = splitBlocksDuration(blocks)
  return (
    <div className='flex shrink-0 gap-1'>
      {[
        [days, 'd'],
        [hours, 'h'],
        [minutes, 'm'],
      ].map(([value, unit]) => (
        <span
          key={unit}
          className='border-separator bg-surface rounded-md border px-1.5 py-0.5 text-sm font-medium tabular-nums'
        >
          {value}
          <span className='text-xs'>{unit}</span>
        </span>
      ))}
    </div>
  )
}

interface OfferSidebarProps {
  offer: OfferDetails
  role: ActorRole
}

export default function OfferSidebar({ offer, role }: OfferSidebarProps) {
  const { scriptPubkey, connectionStatus, reconnecting } = useWallet()
  const { data: currentBlockHeight } = useBlockHeight()
  const { formatCollateralDisplay, formatPrincipalAmount, collateralUnit, formatCollateralAmount } =
    useFormatAmount()
  const { collateralAsset, principalAsset } = NETWORK_CONFIG
  const collateralPriceUsd = useAssetPriceUsd(collateralAsset.id)
  const dueDate = useBlockDate(offer.loan_expiration_height, offer.created_at_height)
  const [isActionOpen, setIsActionOpen] = useState(false)
  const closeAction = useCallback(() => setIsActionOpen(false), [])

  const action = resolveOfferAction(offer, scriptPubkey, currentBlockHeight)
  const isHeightKnown = currentBlockHeight > 0
  const blocksToDeadline = getOfferTermLeft(offer, currentBlockHeight)
  const isExpired = isHeightKnown && blocksToDeadline < 0
  const dueDateText = dueDate ? formatDateTime(dueDate) : '–'
  const blocksAgo = (height: number | null) =>
    height === null || !isHeightKnown
      ? undefined
      : `${formatBlocksDuration(currentBlockHeight - height)} ago`

  const renderPrincipal = (amount: bigint) => (
    <AssetAmount
      value={formatAmount(amount, principalAsset.decimals)}
      unit={principalAsset.symbol}
    />
  )
  const renderCollateral = (amount: bigint) => (
    <AssetAmount value={formatCollateralAmount(amount)} unit={collateralUnit} />
  )

  const deadline: DeadlineView = (() => {
    switch (offer.status) {
      case 'pending':
      case 'active':
        if (!isExpired) {
          return {
            title: offer.status === 'pending' ? 'Loan Deadline In' : 'Time Left',
            subtitle: `Due ${dueDateText}`,
            countdownBlocks: isHeightKnown ? blocksToDeadline : undefined,
          }
        }
        return offer.status === 'active'
          ? {
              title: 'Overdue By',
              subtitle: `Was due ${dueDateText}`,
              countdownBlocks: -blocksToDeadline,
            }
          : {
              title: 'Expired',
              subtitle: `Was due ${dueDateText}`,
              summary: blocksAgo(offer.loan_expiration_height),
            }
      case 'repaid':
      case 'claimed': {
        const repaidHeight = getFullRepaymentHeight(offer)
        const margin = repaidHeight === null ? null : offer.loan_expiration_height - repaidHeight
        return {
          title: 'Repaid',
          subtitle: `Was due ${dueDateText}`,
          summary:
            margin === null
              ? undefined
              : `${formatBlocksDuration(Math.abs(margin))} ${margin >= 0 ? 'early' : 'late'}`,
        }
      }
      case 'cancelled':
        return {
          title: 'Cancelled',
          subtitle: 'Before anyone accepted',
          summary: blocksAgo(getUtxoCreatedHeight(offer, 'cancellation')),
        }
      case 'liquidated':
        return {
          title: 'Expired',
          subtitle: `Was due ${dueDateText}`,
          summary: blocksAgo(offer.loan_expiration_height),
        }
    }
  })()

  const content: ContentView | null = (() => {
    const isBorrower = role === 'borrower'
    const isLender = role === 'lender'
    switch (offer.status) {
      case 'pending': {
        if (isBorrower) {
          return {
            title: 'Waiting for a Lender',
            description: isExpired
              ? 'Nobody accepted before the deadline. Cancel to get your collateral back.'
              : 'You can cancel any time before someone accepts.',
          }
        }
        const term = formatLoanTerm(getLoanDurationBlocks(offer))
        return {
          title: 'Lend',
          amount: renderPrincipal(offer.principal_amount),
          description: isExpired
            ? 'This offer expired before anyone accepted it.'
            : `Locked until the borrower repays – up to ${term.value} ${term.unit.toLowerCase()}. You can withdraw repayments as they come in.`,
        }
      }
      case 'active':
        if (isBorrower) {
          return offer.borrower_principal_utxo
            ? {
                title: 'Your Loan',
                amount: renderPrincipal(offer.principal_amount),
                description:
                  'The loan is funded and waiting in the contract. The repayment clock is already running.',
              }
            : {
                title: 'Your Debt',
                amount: renderPrincipal(offer.current_debt),
                description: isExpired
                  ? 'The deadline has passed. Repay before the lender liquidates your collateral.'
                  : undefined,
              }
        }
        if (isLender) {
          return {
            title: 'Your Vault',
            amount: renderPrincipal(getLenderVaultBalance(offer)),
            description: isExpired
              ? 'The deadline has passed. You can take the collateral for the unpaid debt.'
              : 'Repayments land here, held by the contract until you withdraw them.',
          }
        }
        return null
      case 'repaid':
        if (isLender) {
          return {
            title: 'Your Vault',
            amount: renderPrincipal(getLenderVaultBalance(offer)),
            description: 'Fully repaid – withdraw everything in one go.',
          }
        }
        return isBorrower
          ? {
              title: 'Loan Repaid',
              amount: renderCollateral(offer.collateral_amount),
              description: 'Your collateral is back in your wallet.',
            }
          : null
      case 'claimed':
        if (isLender) {
          return {
            title: 'Withdrawn',
            amount: renderPrincipal(getLenderPayout(offer)),
            description: 'Everything has been withdrawn to your wallet.',
          }
        }
        return isBorrower
          ? {
              title: 'Loan Repaid',
              amount: renderCollateral(offer.collateral_amount),
              description: 'Your collateral is back in your wallet.',
            }
          : null
      case 'cancelled':
        return isBorrower
          ? {
              title: 'Offer Cancelled',
              description: 'Your collateral is back in your wallet.',
            }
          : null
      case 'liquidated': {
        const liquidatedCollateral = getLiquidatedCollateral(offer)
        if (isLender) {
          const usd = formatUsd(liquidatedCollateral, collateralAsset.decimals, collateralPriceUsd)
          const stillOwed = getLenderPayout(offer) - getRepaidToLender(offer)
          return {
            title: 'You Received',
            amount: renderCollateral(liquidatedCollateral),
            description: `${usd ? `≈ ${usd} at today's price, instead` : 'Instead'} of the ${formatPrincipalAmount(stillOwed)} you were owed.`,
          }
        }
        return isBorrower
          ? {
              title: 'Collateral Liquidated',
              amount: renderCollateral(liquidatedCollateral),
              description: offer.borrower_principal_utxo
                ? 'The lender took your collateral. Claim your loan principal.'
                : 'The deadline passed and the lender took your collateral.',
            }
          : null
      }
    }
  })()

  const actionButton = (() => {
    switch (action) {
      case 'none':
        return null
      case 'accept':
        return { label: 'Accept Offer' }
      case 'cancel':
        return {
          label: 'Cancel Offer',
          hint: `Your ${formatCollateralDisplay(offer.collateral_amount)} comes straight back to your wallet.`,
        }
      case 'repay':
        return { label: 'Repay', hint: 'Each payment returns a share of your collateral.' }
      case 'claim-principal':
        return { label: `Claim ${formatPrincipalAmount(offer.principal_amount)}` }
      case 'claim-interest':
        return { label: 'Withdraw All' }
      case 'liquidate':
        return { label: `Liquidate ${formatCollateralDisplay(offer.collateral_remaining)}` }
    }
  })()

  return (
    <section className='bg-surface-secondary flex min-w-0 flex-col gap-4 rounded-3xl p-4 sm:p-6 lg:row-span-2'>
      <div className='flex items-start justify-between gap-3'>
        <div className='flex min-w-0 flex-col'>
          <span className='text-foreground text-sm font-medium'>{deadline.title}</span>
          <span className='text-muted text-xs'>{deadline.subtitle}</span>
        </div>
        {deadline.countdownBlocks !== undefined && <Countdown blocks={deadline.countdownBlocks} />}
        {deadline.summary && (
          <span className='text-foreground shrink-0 text-sm font-medium'>{deadline.summary}</span>
        )}
      </div>

      {content && (
        <div className='flex flex-col gap-3'>
          <span className='text-muted text-sm'>{content.title}</span>
          {content.amount && <p className='text-xl font-semibold break-all'>{content.amount}</p>}
          {content.description && <p className='text-muted text-sm'>{content.description}</p>}
        </div>
      )}

      {reconnecting && <Skeleton className='h-10 w-full rounded-lg' />}
      {!reconnecting && actionButton && action !== 'none' && (
        <div className='flex flex-col gap-2'>
          <UiButton
            className='w-full'
            variant={ACTION_BUTTON_VARIANT[action]}
            onPress={() => setIsActionOpen(true)}
          >
            {actionButton.label}
          </UiButton>
          {'hint' in actionButton && (
            <p className='text-muted text-center text-xs'>{actionButton.hint}</p>
          )}
        </div>
      )}

      <OfferActionModal
        offer={offer}
        isOpen={isActionOpen && connectionStatus !== 'locked' && !reconnecting}
        onClose={closeAction}
        onSuccess={closeAction}
      />
    </section>
  )
}
