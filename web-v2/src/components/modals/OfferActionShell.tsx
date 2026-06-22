import type { MutationStatus } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import {
  TransactionBody,
  TransactionStatusTitle,
  type TransactionSummaryRow,
} from '@/components/TransactionModal'
import { UiButton, type UiButtonProps } from '@/components/ui/UiButton'
import { UiModal } from '@/components/ui/UiModal'

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
  const isTxActive = action !== undefined && action.status !== 'idle'
  const isProcessing = action?.status === 'pending'

  const handleOpenChange = (open: boolean) => {
    if (open) return
    if (action?.status === 'success') onSuccess?.()
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
        isTxActive ? (
          <TransactionStatusTitle status={action.status} eyebrow={action.eyebrow} />
        ) : (
          <span className='flex items-center gap-3'>
            {title}
            {chip}
          </span>
        )
      }
      footer={
        isTxActive ? (
          <UiButton
            className='w-full'
            variant='primary'
            isDisabled={isProcessing}
            onPress={() => handleOpenChange(false)}
          >
            {action.status === 'success' ? 'Done' : 'Close'}
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
      {isTxActive ? (
        <TransactionBody
          status={action.status}
          summary={action.summary}
          txid={action.txid}
          errorMessage={action.error}
        />
      ) : (
        children
      )}
    </UiModal>
  )
}
