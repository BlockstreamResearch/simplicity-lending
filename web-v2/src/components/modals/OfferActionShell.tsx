import type { MutationStatus } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'

import {
  TransactionBody,
  TransactionStatusTitle,
  type TransactionSummaryRow,
} from '@/components/TransactionModal'
import { UiButton, type UiButtonProps } from '@/components/ui/UiButton'
import { UiModal } from '@/components/ui/UiModal'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'

export interface OfferAction {
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
  error?: string
}

// Stable reference so `deriveView(undefined)` doesn't hand back a fresh `[]` every call — that
// would always compare unequal below and force a setState (hence a re-render) on every render.
const EMPTY_SUMMARY: TransactionSummaryRow[] = []

function deriveView(action: OfferAction | undefined): ActionView {
  return {
    isTxActive: action !== undefined && action.status !== 'idle',
    status: action?.status ?? 'idle',
    eyebrow: action?.eyebrow ?? '',
    summary: action?.summary ?? EMPTY_SUMMARY,
    txid: action?.txid,
    error: action?.error,
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

  // Closing a modal resets its mutation (status -> 'idle') synchronously, in the same tick as the
  // close click — while the modal is still playing its exit animation. Without freezing, the
  // title/body would flicker from the success screen to the idle form right as it closes. Keep
  // mirroring the live view while open; once closed, keep rendering whatever was last shown.
  const [frozenView, setFrozenView] = useState(liveView)
  if (
    isOpen &&
    (frozenView.isTxActive !== liveView.isTxActive ||
      frozenView.status !== liveView.status ||
      frozenView.txid !== liveView.txid ||
      frozenView.error !== liveView.error ||
      frozenView.summary !== liveView.summary)
  ) {
    setFrozenView(liveView)
  }
  const view = isOpen ? liveView : frozenView

  const isProcessing = action?.status === 'pending'

  const handleOpenChange = (open: boolean) => {
    if (open) return
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
        view.isTxActive ? (
          <TransactionStatusTitle status={view.status} eyebrow={view.eyebrow} />
        ) : (
          <span className='flex items-center gap-3'>
            {title}
            {chip}
          </span>
        )
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
      {view.isTxActive ? (
        <TransactionBody
          status={view.status}
          summary={view.summary}
          txid={view.txid}
          errorMessage={view.error}
        />
      ) : (
        children
      )}
    </UiModal>
  )
}
