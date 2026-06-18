import { Skeleton } from '@heroui/react'
import type { MutationStatus } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { useBlockHeight } from '@/api/esplora/hooks'
import type { OfferDetails, OfferShort } from '@/api/indexer/schemas'
import BalanceCard from '@/components/BalanceCard'
import DetailsPanel, { type DetailRow } from '@/components/DetailsPanel'
import TransactionModal, { type TransactionSummaryRow } from '@/components/TransactionModal'
import { UiButton, type UiButtonProps } from '@/components/ui/UiButton'
import { UiModal } from '@/components/ui/UiModal'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useWallet } from '@/providers/wallet/useWallet'
import { formatAmount, truncateAddress } from '@/utils/format'
import { bpsToPercent, calcInterest, formatOfferTermLeft } from '@/utils/offers'

type Counterparty = 'borrower' | 'lender'

/** Action + its transaction state. Omit for a read-only info modal (no footer, no tx flow). */
interface OfferModalAction {
  label: string
  variant?: UiButtonProps['variant']
  eyebrow: string
  summary: TransactionSummaryRow[]
  status: MutationStatus
  disabled?: boolean
  txid?: string
  error?: string
  onConfirm: () => void
}

interface OfferModalProps {
  isOpen: boolean
  offer: OfferShort
  fullOffer?: OfferDetails | null
  title: ReactNode
  chip: ReactNode
  counterparty?: Counterparty
  highlightTerm?: boolean
  principalLabel: string
  action?: OfferModalAction
  onClose: () => void
  onSuccess?: () => void
}

export default function OfferModal({
  isOpen,
  offer,
  fullOffer,
  title,
  chip,
  counterparty = 'borrower',
  highlightTerm,
  principalLabel,
  action,
  onClose,
  onSuccess,
}: OfferModalProps) {
  const { collateralAsset, principalAsset } = NETWORK_CONFIG
  const { balances } = useWallet()
  const blockHeightQuery = useBlockHeight()
  const currentBlockHeight = blockHeightQuery.data ?? 0

  if (action && action.status !== 'idle') {
    return (
      <TransactionModal
        isOpen={isOpen}
        eyebrow={action.eyebrow}
        status={action.status}
        summary={action.summary}
        txid={action.txid}
        errorMessage={action.error}
        onClose={() => {
          if (action.status === 'success') onSuccess?.()
          onClose()
        }}
      />
    )
  }

  const interest = calcInterest(offer.principal_amount, offer.interest_rate)
  const counterpartyParticipant = fullOffer?.participants.find(
    p => p.participant_type === counterparty,
  )
  const counterpartyLabel = counterparty === 'lender' ? 'Lender Address' : 'Borrower Address'

  const loanInfoRows: DetailRow[] = [
    {
      label: 'Collateral Amount',
      value: `${formatAmount(offer.collateral_amount, collateralAsset.decimals)} ${collateralAsset.symbol}`,
    },
    {
      label: principalLabel,
      value: `${formatAmount(offer.principal_amount, principalAsset.decimals)} ${principalAsset.symbol}`,
    },
    { label: 'Total Fee', value: '–' },
    {
      label: 'Expected Earning',
      value: `${formatAmount(interest, principalAsset.decimals)} ${principalAsset.symbol}`,
    },
    { label: 'APR', value: bpsToPercent(offer.interest_rate) },
    { label: 'LTV & Risk Level', value: '–' },
    {
      label: counterpartyLabel,
      value: (() => {
        if (fullOffer === undefined) return '–'
        if (fullOffer === null) return <Skeleton className='h-4 w-28' />
        return counterpartyParticipant
          ? truncateAddress(counterpartyParticipant.script_pubkey)
          : '–'
      })(),
    },
  ]

  const termRows: DetailRow[] = [
    {
      label: 'Duration (Expires at)',
      value: formatOfferTermLeft(offer, currentBlockHeight),
    },
    { label: 'Current Block', value: String(currentBlockHeight) },
    { label: 'Repayment Due Block', value: `#${offer.loan_expiration_height}` },
    {
      label: 'Blocks to Liquidation',
      value: `${Math.max(0, offer.loan_expiration_height - currentBlockHeight)} Blocks`,
    },
  ]

  return (
    <UiModal
      isOpen={isOpen}
      onOpenChange={open => {
        if (!open) onClose()
      }}
      title={
        <span className='flex items-center gap-3'>
          {title}
          {chip}
        </span>
      }
      size='lg'
      footer={
        action ? (
          <UiButton
            className='w-full'
            variant={action.variant ?? 'primary'}
            isDisabled={action.disabled}
            onPress={action.onConfirm}
          >
            {action.label}
          </UiButton>
        ) : undefined
      }
    >
      <div className='flex flex-col gap-6'>
        <BalanceCard asset={principalAsset} amount={BigInt(balances[principalAsset.id] ?? 0)} />
        <DetailsPanel title='Loan info' rows={loanInfoRows} />
        <DetailsPanel title='Term' rows={termRows} bordered={highlightTerm} />
      </div>
    </UiModal>
  )
}
