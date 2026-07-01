import { Spinner, Toast } from '@heroui/react'
import type { MutationStatus } from '@tanstack/react-query'
import { type ReactNode, useEffect, useMemo } from 'react'

import { getTxExplorerUrl } from '@/api/esplora/utils'
import CheckIcon from '@/components/icons/CheckIcon'
import CircleExclamationIcon from '@/components/icons/CircleExclamationIcon'
import { UiButton } from '@/components/ui/UiButton'
import { UiModal } from '@/components/ui/UiModal'
import { type TxStatus, useTxStatus } from '@/hooks/useTxStatus'
import { useTxProgress } from '@/providers/txProgress/useTxProgress'
import { truncateAddress } from '@/utils/format'

import TransactionStepper from './TransactionStepper'

export interface TransactionSummaryRow {
  label: string
  value: ReactNode
}

interface TransactionModalProps {
  isOpen: boolean
  eyebrow: string
  status: MutationStatus
  summary?: TransactionSummaryRow[]
  txid?: string | null
  onClose: () => void
}

function StatusIcon({ status, isComplete }: { status: MutationStatus; isComplete: boolean }) {
  if (isComplete) {
    return (
      <span className='bg-success/15 text-success flex size-10 items-center justify-center rounded-full'>
        <CheckIcon className='size-5' />
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className='bg-danger/15 text-danger flex size-10 items-center justify-center rounded-full'>
        <CircleExclamationIcon className='size-5' />
      </span>
    )
  }
  return (
    <span className='flex size-10 items-center justify-center'>
      <Spinner size='md' />
    </span>
  )
}

function statusTitle(status: MutationStatus, isComplete: boolean): string {
  if (isComplete) return 'Transaction Complete'
  if (status === 'error') return 'Transaction Failed'
  return status === 'pending' ? 'Processing Transaction…' : 'Transaction Pending…'
}

export function TransactionStatusTitle({
  status,
  eyebrow,
  isComplete,
}: {
  status: MutationStatus
  eyebrow: string
  isComplete: boolean
}) {
  return (
    <span className='flex items-center gap-3'>
      <StatusIcon status={status} isComplete={isComplete} />
      <span className='flex flex-col'>
        <span className='text-sm font-normal'>{eyebrow}</span>
        <span>{statusTitle(status, isComplete)}</span>
      </span>
    </span>
  )
}

interface TransactionBodyProps {
  status: MutationStatus
  summary?: TransactionSummaryRow[]
  txid?: string | null
  txStatus: TxStatus | null
  confirmations: number | null
}

function notifyTxConfirmed(txid: string, confirmations: number) {
  Toast.toast.success('Transaction Confirmed', {
    description: `${confirmations} confirmation${confirmations !== 1 ? 's' : ''} received.`,
    actionProps: {
      children: 'View',
      onPress: () => window.open(getTxExplorerUrl(txid), '_blank', 'noopener'),
    },
  })
}

export function TransactionBody({
  status,
  summary = [],
  txid,
  txStatus,
  confirmations,
}: TransactionBodyProps) {
  const { currentStepId } = useTxProgress()

  useEffect(() => {
    if (txid && txStatus === 'finalized' && confirmations !== null) {
      notifyTxConfirmed(txid, confirmations)
    }
  }, [txStatus, txid, confirmations])

  const rows = useMemo<TransactionSummaryRow[]>(
    () => [
      ...summary,
      ...(txid
        ? [
            {
              label: 'Transaction ID',
              value: (
                <a
                  className='text-accent underline'
                  href={getTxExplorerUrl(txid)}
                  target='_blank'
                  rel='noopener noreferrer'
                >
                  {truncateAddress(txid)}
                </a>
              ),
            },
            {
              label: 'Status',
              value:
                txStatus === 'finalized'
                  ? 'Finalized'
                  : txStatus === 'confirmed'
                    ? 'Confirmed'
                    : 'Pending…',
            },
            ...(confirmations
              ? [
                  {
                    label: 'Confirmations',
                    value: `${confirmations} Confirmation${confirmations !== 1 ? 's' : ''}`,
                  },
                ]
              : []),
          ]
        : []),
    ],
    [summary, txid, txStatus, confirmations],
  )

  return (
    <div className='flex flex-col gap-4'>
      {rows.length > 0 && (
        <div className='bg-surface-secondary flex flex-col rounded-xl p-6'>
          {rows.map((row, index) => (
            <div key={row.label} className={index > 0 ? 'border-separator mt-3 border-t pt-3' : ''}>
              <div className='flex items-center justify-between text-sm'>
                <span className='font-medium'>{row.label}</span>
                <span className='font-medium'>{row.value}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {(status === 'pending' || status === 'error') && currentStepId && (
        <div className='bg-surface-secondary rounded-xl p-6'>
          <TransactionStepper />
        </div>
      )}
    </div>
  )
}

export default function TransactionModal({
  isOpen,
  eyebrow,
  status,
  summary = [],
  txid,
  onClose,
}: TransactionModalProps) {
  const {
    status: txStatus,
    confirmations,
    isComplete,
  } = useTxStatus(status === 'success' ? txid : null)
  const isProcessing = status === 'pending'

  return (
    <UiModal
      isOpen={isOpen}
      onOpenChange={open => {
        if (!open) onClose()
      }}
      isDismissable={!isProcessing}
      showCloseButton={!isProcessing}
      size='md'
      title={<TransactionStatusTitle status={status} eyebrow={eyebrow} isComplete={isComplete} />}
      footer={
        <UiButton className='w-full' variant='primary' isDisabled={isProcessing} onPress={onClose}>
          {status === 'success' ? 'Done' : 'Close'}
        </UiButton>
      }
    >
      <TransactionBody
        status={status}
        summary={summary}
        txid={txid}
        txStatus={txStatus}
        confirmations={confirmations}
      />
    </UiModal>
  )
}
