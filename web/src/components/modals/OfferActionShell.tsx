import type { MutationStatus } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'

import {
  TransactionBody,
  TransactionStatusTitle,
  type TransactionSummaryRow,
} from '@/components/TransactionModal'
import { UiButton, type UiButtonProps } from '@/components/ui/UiButton'
import { UiModal } from '@/components/ui/UiModal'
import { useTxStatus } from '@/hooks/useTxStatus'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'

export interface OfferAction {
  label: string
  variant?: UiButtonProps['variant']
  eyebrow: string
  summary: TransactionSummaryRow[]
  status: MutationStatus
  disabled?: boolean
  txid?: string
  onConfirm: () => void
}

interface OfferActionShellProps {
  isOpen: boolean
  title: ReactNode
  chip: ReactNode
  action?: OfferAction
  onClose: () => void
  onSuccess?: () => void
  children: ReactNode
}

interface ActionView {
  isTxActive: boolean
  status: MutationStatus
  eyebrow: string
  summary: TransactionSummaryRow[]
  txid?: string
}

interface ClosingSnapshot {
  view: ActionView
  tx: ReturnType<typeof useTxStatus>
}

const EMPTY_SUMMARY: TransactionSummaryRow[] = []

function deriveView(action: OfferAction | undefined): ActionView {
  return {
    isTxActive: action !== undefined && action.status !== 'idle',
    status: action?.status ?? 'idle',
    eyebrow: action?.eyebrow ?? '',
    summary: action?.summary ?? EMPTY_SUMMARY,
    txid: action?.txid,
  }
}

// TODO: Consider replacing with UiModal + proper component decomposition (details, tx status) inside each action modal
export default function OfferActionShell({
  isOpen,
  title,
  chip,
  action,
  onClose,
  onSuccess,
  children,
}: OfferActionShellProps) {
  const { addSurfaceToast } = usePendingTransactions()
  const liveView = deriveView(action)
  const liveTx = useTxStatus(action?.status === 'success' ? action.txid : null)

  const [closing, setClosing] = useState<ClosingSnapshot | null>(null)
  const [wasOpen, setWasOpen] = useState(isOpen)
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen)
    if (isOpen && closing) setClosing(null)
  }

  const view = closing?.view ?? liveView
  const { status: txStatus, confirmations, isComplete } = closing?.tx ?? liveTx

  const isProcessing = action?.status === 'pending'

  const handleOpenChange = (open: boolean) => {
    if (open) return
    if (liveView.isTxActive) setClosing({ view: liveView, tx: liveTx })
    if (action?.status === 'success') onSuccess?.()
    if (action?.txid) addSurfaceToast(action.txid)
    onClose()
  }

  return (
    <UiModal
      isOpen={isOpen}
      onOpenChange={handleOpenChange}
      isDismissable={!isProcessing}
      showCloseButton={!isProcessing}
      size='lg'
      title={
        <span key={view.isTxActive ? 'tx' : 'form'} className='animate-modal-view-in block'>
          {view.isTxActive ? (
            <TransactionStatusTitle
              status={view.status}
              eyebrow={view.eyebrow}
              isComplete={isComplete}
            />
          ) : (
            <span className='flex items-center gap-3'>
              {title}
              {chip}
            </span>
          )}
        </span>
      }
      footer={
        view.isTxActive ? (
          <UiButton
            className='w-full'
            variant='primary'
            isDisabled={isProcessing}
            onPress={() => handleOpenChange(false)}
          >
            {view.status === 'success' ? 'Done' : 'Close'}
          </UiButton>
        ) : action ? (
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
      <div key={view.isTxActive ? 'tx' : 'form'} className='animate-modal-view-in block'>
        {view.isTxActive ? (
          <TransactionBody
            status={view.status}
            summary={view.summary}
            txid={view.txid}
            txStatus={txStatus}
            confirmations={confirmations}
          />
        ) : (
          children
        )}
      </div>
    </UiModal>
  )
}
