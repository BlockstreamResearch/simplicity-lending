import { Spinner } from '@heroui/react'
import { type ReactNode, useMemo } from 'react'

import { getTxExplorerUrl } from '@/api/esplora/utils'
import CheckIcon from '@/components/icons/CheckIcon'
import CircleExclamationIcon from '@/components/icons/CircleExclamationIcon'
import { UiButton } from '@/components/ui/UiButton'
import { UiModal } from '@/components/ui/UiModal'
import type { TransactionPhase } from '@/hooks/useTransaction'
import { useTxConfirmations } from '@/hooks/useTxConfirmations'
import { truncateAddress } from '@/utils/format'

export interface TransactionSummaryRow {
  label: string
  value: ReactNode
}

type ActiveTransactionPhase = Exclude<TransactionPhase, 'idle'>

interface TransactionModalProps {
  isOpen: boolean
  eyebrow: string
  phase: ActiveTransactionPhase
  summary?: TransactionSummaryRow[]
  txid?: string | null
  errorMessage?: string | null
  onClose: () => void
}

const TITLE: Record<ActiveTransactionPhase, string> = {
  processing: 'Processing Transaction…',
  success: 'Transaction Complete',
  error: 'Transaction Failed',
}

function StatusIcon({ phase }: { phase: ActiveTransactionPhase }) {
  if (phase === 'success') {
    return (
      <span className='bg-success/15 text-success flex size-10 items-center justify-center rounded-full'>
        <CheckIcon className='size-5' />
      </span>
    )
  }
  if (phase === 'error') {
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

export default function TransactionModal({
  isOpen,
  eyebrow,
  phase,
  summary = [],
  txid,
  errorMessage,
  onClose,
}: TransactionModalProps) {
  const txConfirmations = useTxConfirmations({ txid })
  const isProcessing = phase === 'processing'

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
              label: 'Confirmations',
              value: txConfirmations === null ? 'Pending…' : String(txConfirmations.confirmations),
            },
          ]
        : []),
    ],
    [summary, txid, txConfirmations],
  )

  return (
    <UiModal
      isOpen={isOpen}
      onOpenChange={open => {
        if (!open) onClose()
      }}
      isDismissable={!isProcessing}
      showCloseButton={!isProcessing}
      size='md'
      title={
        <span className='flex items-center gap-3'>
          <StatusIcon phase={phase} />
          <span className='flex flex-col'>
            <span className='text-sm font-normal'>{eyebrow}</span>
            <span>{TITLE[phase]}</span>
          </span>
        </span>
      }
      footer={
        <UiButton className='w-full' variant='primary' isDisabled={isProcessing} onPress={onClose}>
          {phase === 'success' ? 'Done' : 'Close'}
        </UiButton>
      }
    >
      <div className='flex flex-col gap-4'>
        {rows.length > 0 && (
          <div className='bg-surface-secondary flex flex-col rounded-xl p-6'>
            {rows.map((row, index) => (
              <div
                key={row.label}
                className={index > 0 ? 'border-separator mt-3 border-t pt-3' : ''}
              >
                <div className='flex items-center justify-between text-sm'>
                  <span className='font-medium'>{row.label}</span>
                  <span className='font-medium'>{row.value}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        {phase === 'error' && errorMessage && (
          <p className='text-danger text-sm wrap-break-word'>{errorMessage}</p>
        )}
      </div>
    </UiModal>
  )
}
