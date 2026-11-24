import { Separator, Skeleton } from '@heroui/react'
import { type ReactNode, useCallback, useState } from 'react'

import { useBlockHeight } from '@/api/esplora/hooks'
import type { OfferDetails } from '@/api/indexer/schemas'
import { getWithdrawableAmount } from '@/api/indexer/utils'
import { useAssetPriceUsd } from '@/api/prices/hooks'
import { AssetAmount } from '@/components/AssetAmount'
import TriangleExclamationIcon from '@/components/icons/TriangleExclamationIcon'
import OfferActionModal from '@/components/modals/OfferActionModal'
import { UiButton, type UiButtonProps } from '@/components/ui/UiButton'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { REPAYMENT_DUE_THRESHOLD_BLOCKS, VAULT_MIN_REMAINDER } from '@/constants/offers'
import { useBlockDate } from '@/hooks/useBlockDate'
import { useFormatAmount } from '@/hooks/useFormatAmount'
import { useNow } from '@/hooks/useNow'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
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
import { getOfferPendingTx, isBlockingTxStuck } from '@/utils/pendingTransactions'

import {
  formatBlocksAgo,
  formatLoanTerm,
  getFullRepaymentHeight,
  getLenderPayout,
  getLenderVaultBalance,
  getLiquidatedCollateral,
  getLiquidationVaultPayout,
  getLoanDurationBlocks,
  getRepaidToLender,
  getUtxoCreatedHeight,
} from '../helpers'

const STUCK_CHECK_INTERVAL_MS = 15_000

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
  tone?: 'warning' | 'danger'
}

interface ActionPanelView {
  buttons: { action: ActionWithButton; label: string; variant?: UiButtonProps['variant'] }[]
  hint?: string
}

interface ContentView {
  title: string
  amount?: ReactNode
  description?: string
}

function Countdown({ blocks, isOverdue }: { blocks: number; isOverdue: boolean }) {
  const { days, hours, minutes } = splitBlocksDuration(blocks)
  return (
    <div className='flex shrink-0 gap-2'>
      {[
        [days, 'd'],
        [hours, 'h'],
        [minutes, 'm'],
      ].map(([value, unit]) => (
        <span
          key={unit}
          className={`bg-surface flex items-baseline rounded-sm border px-1.5 py-1 tabular-nums ${
            isOverdue ? 'border-danger-soft text-danger' : 'border-separator text-foreground'
          }`}
        >
          <span className='text-h3'>{value}</span>
          <span className='text-xs font-medium'>{unit}</span>
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
  const { pendingTxs } = usePendingTransactions()
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
  const now = useNow(STUCK_CHECK_INTERVAL_MS)
  const offerPendingTx = getOfferPendingTx(offer.id, pendingTxs)
  const processingHint = (() => {
    if (!offerPendingTx) return null
    if (offerPendingTx.confirmationStatus !== 'processing') return 'Confirmed, updating the offer…'
    return isBlockingTxStuck(offerPendingTx, now) ? null : 'Waiting for confirmation…'
  })()

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
            title: offer.status === 'pending' ? 'Loan Deadline In' : 'Due In',
            subtitle: `Due ${dueDateText}`,
            countdownBlocks: isHeightKnown ? blocksToDeadline : undefined,
            tone:
              offer.status === 'active' &&
              isHeightKnown &&
              blocksToDeadline < REPAYMENT_DUE_THRESHOLD_BLOCKS
                ? 'warning'
                : undefined,
          }
        }
        return offer.status === 'active'
          ? {
              title: 'Overdue By',
              subtitle: `Was due ${dueDateText}`,
              countdownBlocks: -blocksToDeadline,
              tone: 'danger',
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
          return {
            title: 'Your Vault',
            amount: renderPrincipal(vaultBalance),
            description: (() => {
              if (isExpired) {
                return vaultBalance > 0n
                  ? 'The deadline has passed. Liquidate to take the collateral and everything in your vault.'
                  : 'The deadline has passed. You can take the collateral for the unpaid debt.'
              }
              return withdrawable > 0n
                ? 'The borrower has repaid part of the loan. You can withdraw it now.'
                : 'Repayments land here, held by the contract until you withdraw them.'
            })(),
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
          const stillOwed = getLenderPayout(offer) - getRepaidToLender(offer)
          const vaultPayout = getLiquidationVaultPayout(offer)
          const collateralValueInPrincipal =
            collateralPriceUsd === null
              ? null
              : BigInt(
                  Math.round(
                    Number(liquidatedCollateral) *
                      collateralPriceUsd *
                      10 ** (principalAsset.decimals - collateralAsset.decimals),
                  ),
                )
          const receivedUsd =
            collateralValueInPrincipal === null
              ? null
              : formatUsd(collateralValueInPrincipal + vaultPayout, principalAsset.decimals, 1)
          return {
            title: 'You Received',
            amount:
              vaultPayout > 0n ? (
                <span className='flex flex-col gap-2'>
                  <span className='flex flex-col gap-0.5'>
                    <span className='text-muted text-sm font-medium'>Collateral</span>
                    <span>{renderCollateral(liquidatedCollateral)}</span>
                  </span>
                  <span className='flex flex-col gap-0.5'>
                    <span className='text-muted text-sm font-medium'>From Your Vault</span>
                    <span>{renderPrincipal(vaultPayout)}</span>
                  </span>
                </span>
              ) : (
                renderCollateral(liquidatedCollateral)
              ),
            description: `${receivedUsd ? `≈ ${receivedUsd}${vaultPayout > 0n ? ' in total' : ''} at today's price, instead` : 'Instead'} of the ${formatPrincipalAmount(stillOwed)} you were owed.`,
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
    const withdrawButton = {
      action: 'withdraw',
      label: `Withdraw ${formatPrincipalAmount(withdrawable)}`,
    } as const

    switch (action) {
      case 'none':
        return role === 'lender' &&
          offer.status === 'active' &&
          isHeightKnown &&
          !isExpired &&
          withdrawable > 0n
          ? {
              buttons: [withdrawButton],
              hint: `${formatPrincipalAmount(VAULT_MIN_REMAINDER)} stays in the vault until the loan closes. You get it back at the end.`,
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
              buttons: [liquidateButton, { ...withdrawButton, variant: 'tertiary' }],
              hint: 'Withdraw keeps the loan open, the borrower can still repay.',
            }
          : { buttons: [liquidateButton] }
    }
  })()

  return (
    <section className='bg-surface-secondary flex min-w-0 flex-col gap-3 rounded-3xl p-4 sm:p-6 lg:row-span-2'>
      <div className='flex items-center justify-between gap-3'>
        <div className='flex min-w-0 flex-col gap-1'>
          <span
            className={`text-h4 flex items-center gap-1.5 ${
              deadline.tone === 'danger' ? 'text-danger' : 'text-foreground'
            }`}
          >
            {deadline.title}
            {deadline.tone === 'warning' && (
              <TriangleExclamationIcon className='text-warning size-4 shrink-0' />
            )}
          </span>
          <span className='text-muted text-xs'>{deadline.subtitle}</span>
        </div>
        {deadline.countdownBlocks !== undefined && (
          <Countdown blocks={deadline.countdownBlocks} isOverdue={deadline.tone === 'danger'} />
        )}
        {deadline.summary && (
          <span className='text-foreground shrink-0 text-sm font-medium'>{deadline.summary}</span>
        )}
      </div>

      {content && (
        <>
          <Separator />
          <div className='flex flex-col gap-3'>
            <span className='text-h4 text-muted'>{content.title}</span>
            {content.amount && <p className='text-xl font-semibold break-all'>{content.amount}</p>}
            {content.description && <p className='text-muted'>{content.description}</p>}
          </div>
        </>
      )}

      {reconnecting && <Skeleton className='mt-3 h-10 w-full rounded-sm' />}
      {!reconnecting && actionPanel && (
        <div className='mt-3 flex flex-col gap-3'>
          {actionPanel.buttons.map(button => (
            <UiButton
              key={button.action}
              className='w-full'
              size='lg'
              variant={button.variant ?? ACTION_BUTTON_VARIANT[button.action]}
              isPending={processingHint !== null}
              onPress={() => setOpenedAction(button.action)}
            >
              {button.label}
            </UiButton>
          ))}
          {(processingHint ?? actionPanel.hint) && (
            <p className='text-muted text-center text-xs'>{processingHint ?? actionPanel.hint}</p>
          )}
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
