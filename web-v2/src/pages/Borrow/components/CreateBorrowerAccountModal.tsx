import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import CircleDashedIcon from '@/components/icons/CircleDashedIcon'
import TransactionModal from '@/components/TransactionModal'
import { UiButton } from '@/components/ui/UiButton'
import { UiModal } from '@/components/ui/UiModal'
import { useBorrowerAccount } from '@/hooks/useBorrowerAccount'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'

interface CreateBorrowerAccountModalProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onClose: () => void
}

export default function CreateBorrowerAccountModal({
  isOpen,
  onOpenChange,
  onClose,
}: CreateBorrowerAccountModalProps) {
  const { createBorrowerAccount, refetchFactory, scriptPubkey } = useBorrowerAccount()
  const { addPendingTx, surfaceToast } = usePendingTransactions()
  const { mutate, reset, data, error, status } = useMutation({
    mutationFn: createBorrowerAccount,
    onSuccess: result => {
      void addPendingTx({
        txid: result.txid,
        kind: 'create_borrower_account',
        walletScriptPubkey: scriptPubkey ?? '',
      })
    },
  })

  const liveTxid = data?.txid ?? null
  const liveErrorMessage = error?.message
  const [frozen, setFrozen] = useState({ status, txid: liveTxid, errorMessage: liveErrorMessage })
  if (
    isOpen &&
    (frozen.status !== status ||
      frozen.txid !== liveTxid ||
      frozen.errorMessage !== liveErrorMessage)
  ) {
    setFrozen({ status, txid: liveTxid, errorMessage: liveErrorMessage })
  }
  const view = isOpen ? { status, txid: liveTxid, errorMessage: liveErrorMessage } : frozen

  const handleClose = () => {
    if (data?.txid) surfaceToast(data.txid)
    reset()
    onOpenChange(false)
    refetchFactory()
    onClose()
  }

  if (view.status !== 'idle') {
    return (
      <TransactionModal
        isOpen={isOpen}
        eyebrow='New Borrower Account'
        status={view.status}
        txid={view.txid}
        errorMessage={view.errorMessage}
        onClose={handleClose}
      />
    )
  }

  return (
    <UiModal
      isOpen={isOpen}
      onOpenChange={open => {
        if (!open) handleClose()
      }}
      title={
        <span className='flex items-center gap-3'>
          <span className='bg-default flex size-10 items-center justify-center rounded-full'>
            <CircleDashedIcon className='size-5' />
          </span>
          Create Borrower Account
        </span>
      }
      footer={
        <>
          <UiButton variant='secondary' onPress={handleClose}>
            Cancel
          </UiButton>
          <UiButton variant='primary' onPress={() => mutate()}>
            Create
          </UiButton>
        </>
      }
    >
      <p className='text-muted text-sm'>Required to create borrow offers.</p>
    </UiModal>
  )
}
