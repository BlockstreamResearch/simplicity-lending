import { Spinner } from '@heroui/react'
import type { MutationStatus } from '@tanstack/react-query'
import { type ReactNode, useMemo } from 'react'

import { getTxExplorerUrl } from '@/api/esplora/utils'
import CheckIcon from '@/components/icons/CheckIcon'
import CircleExclamationIcon from '@/components/icons/CircleExclamationIcon'
import { UiButton } from '@/components/ui/UiButton'
import { UiModal } from '@/components/ui/UiModal'
import { useTxStatus } from '@/hooks/useTxStatus'
import { truncateAddress } from '@/utils/format'

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
  errorMessage?: string | null
  onClose: () => void
}

const TITLE: Record<MutationStatus, string> = {
  idle: 'Transaction not started',
  pending: 'Processing Transaction…',
  success: 'Transaction Complete',
  error: 'Transaction Failed',
}

function StatusIcon({ status }: { status: MutationStatus }) {
  if (status === 'success') {
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

export function TransactionStatusTitle({
  status,
  eyebrow,
}: {
  status: MutationStatus
  eyebrow: string
}) {
  return (
    <span className='flex items-center gap-3'>
      <StatusIcon status={status} />
      <span className='flex flex-col'>
        <span className='text-sm font-normal'>{eyebrow}</span>
        <span>{TITLE[status]}</span>
      </span>
    </span>
  )
}

interface TransactionBodyProps {
  status: MutationStatus
  summary?: TransactionSummaryRow[]
  txid?: string | null
  errorMessage?: string | null
}

export function TransactionBody({
  status,
  summary = [],
  txid,
  errorMessage,
}: TransactionBodyProps) {
  const { status: txStatus, confirmations } = useTxStatus(txid)

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
      {status === 'error' && errorMessage && (
        <p className='text-danger text-sm wrap-break-word'>{errorMessage}</p>
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
  errorMessage,
  onClose,
}: TransactionModalProps) {
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
      title={<TransactionStatusTitle status={status} eyebrow={eyebrow} />}
      footer={
        <UiButton className='w-full' variant='primary' isDisabled={isProcessing} onPress={onClose}>
          {status === 'success' ? 'Done' : 'Close'}
        </UiButton>
      }
    >
      <TransactionBody status={status} summary={summary} txid={txid} errorMessage={errorMessage} />
    </UiModal>
  )
}
