import { Skeleton } from '@heroui/react'
import { type ReactNode, useCallback, useState } from 'react'

import { useBlockHeight } from '@/api/esplora/hooks'
import type { OfferDetails } from '@/api/indexer/schemas'
import { getWithdrawableAmount } from '@/api/indexer/utils'
import { useAssetPriceUsd } from '@/api/prices/hooks'
import { AssetAmount } from '@/components/AssetAmount'
import OfferActionModal from '@/components/modals/OfferActionModal'
import { UiButton, type UiButtonProps } from '@/components/ui/UiButton'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { VAULT_MIN_REMAINDER } from '@/constants/offers'
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
import { type ActorRole, type OfferModalAction, resolveOfferAction } from '@/utils/offerActions'
import { getOfferTermLeft } from '@/utils/offers'

import {
  formatBlocksAgo,
  formatLoanTerm,
  getFullRepaymentHeight,
  getLenderPayout,
  getLenderVaultBalance,
  getLiquidatedCollateral,
  getLoanDurationBlocks,
  getRepaidToLender,
  getUtxoCreatedHeight,
} from '../helpers'

type ActionWithButton = Exclude<OfferModalAction, 'none'>
const ACTION_BUTTON_VARIANT: Record<ActionWithButton, UiButtonProps['variant']> = {
  accept: 'primary',
  cancel: 'danger-soft',
  repay: 'primary',
  'claim-principal': 'primary',
  withdraw: 'primary',
  'withdraw-all': 'primary',
  liquidate: 'danger',
}

interface DeadlineView {
  title: string
  subtitle: string
  countdownBlocks?: number
  summary?: string | null
}

interface ActionPanelView {
  buttons: { action: ActionWithButton; label: string }[]
  hint?: string
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
  const [openedAction, setOpenedAction] = useState<ActionWithButton | null>(null)
  const closeAction = useCallback(() => setOpenedAction(null), [])

  const action = resolveOfferAction(offer, scriptPubkey, currentBlockHeight)
  const isHeightKnown = currentBlockHeight > 0
  const blocksToDeadline = getOfferTermLeft(offer, currentBlockHeight)
  const isExpired = isHeightKnown && blocksToDeadline < 0
  const vaultBalance = getLenderVaultBalance(offer)
  const withdrawable = getWithdrawableAmount(offer)
  const dueDateText = dueDate ? formatDateTime(dueDate) : '–'

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
              summary: formatBlocksAgo(currentBlockHeight, offer.loan_expiration_height),
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
              ? null
              : `${formatBlocksDuration(Math.abs(margin))} ${margin >= 0 ? 'early' : 'late'}`,
        }
      }
      case 'cancelled':
        return {
          title: 'Cancelled',
          subtitle: 'Before anyone accepted',
          summary: formatBlocksAgo(currentBlockHeight, getUtxoCreatedHeight(offer, 'cancellation')),
        }
      case 'liquidated':
        return {
          title: 'Expired',
          subtitle: `Was due ${dueDateText}`,
          summary: formatBlocksAgo(currentBlockHeight, offer.loan_expiration_height),
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
                description: isExpired
                  ? 'The deadline has passed. Claim your loan, then repay before the lender liquidates your collateral.'
                  : 'The loan is funded and waiting in the contract. The repayment clock is already running.',
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
          const description = (() => {
            if (isExpired)
              return 'The deadline has passed. You can take the collateral for the unpaid debt.'
            return withdrawable > 0n
              ? undefined
              : 'Repayments land here. You can withdraw them as they come in.'
          })()
          return {
            title: 'Your Vault',
            amount: renderPrincipal(vaultBalance),
            description,
          }
        }
        return null
      case 'repaid':
        if (isLender) {
          return {
            title: 'Your Vault',
            amount: renderPrincipal(vaultBalance),
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

  const actionPanel: ActionPanelView | null = (() => {
    const liquidateButton = {
      action: 'liquidate',
      label: `Liquidate ${formatCollateralDisplay(offer.collateral_remaining)}`,
    } as const
    const withdrawButton = { action: 'withdraw', label: 'Withdraw' } as const

    switch (action) {
      case 'none':
        return role === 'lender' && withdrawable > 0n
          ? {
              buttons: [withdrawButton],
              hint: `${formatPrincipalAmount(VAULT_MIN_REMAINDER)} stays in the vault until the loan is closed.`,
            }
          : null
      case 'accept':
        return { buttons: [{ action, label: 'Accept Offer' }] }
      case 'cancel':
        return {
          buttons: [{ action, label: 'Cancel Offer' }],
          hint: `Your ${formatCollateralDisplay(offer.collateral_amount)} comes straight back to your wallet.`,
        }
      case 'repay':
        return {
          buttons: [{ action, label: 'Repay' }],
          hint: 'Each payment returns a share of your collateral.',
        }
      case 'claim-principal':
        return {
          buttons: [{ action, label: `Claim ${formatPrincipalAmount(offer.principal_amount)}` }],
        }
      case 'withdraw-all':
        return { buttons: [{ action, label: 'Withdraw All' }] }
      case 'liquidate':
        return withdrawable > 0n
          ? {
              buttons: [liquidateButton, withdrawButton],
              hint: "Liquidate also sends you what's left in your vault.",
            }
          : { buttons: [liquidateButton] }
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
      {!reconnecting && actionPanel && (
        <div className='flex flex-col gap-2'>
          {actionPanel.buttons.map(button => (
            <UiButton
              key={button.action}
              className='w-full'
              variant={ACTION_BUTTON_VARIANT[button.action]}
              onPress={() => setOpenedAction(button.action)}
            >
              {button.label}
            </UiButton>
          ))}
          {actionPanel.hint && <p className='text-muted text-center text-xs'>{actionPanel.hint}</p>}
        </div>
      )}

      <OfferActionModal
        offer={offer}
        action={openedAction ?? undefined}
        isOpen={openedAction !== null && connectionStatus !== 'locked' && !reconnecting}
        onClose={closeAction}
        onSuccess={closeAction}
      />
    </section>
  )
}
