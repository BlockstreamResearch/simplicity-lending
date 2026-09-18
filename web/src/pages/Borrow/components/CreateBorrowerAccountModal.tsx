import { useMutation } from '@tanstack/react-query'

import UserIcon from '@/components/icons/UserIcon'
import TransactionModal from '@/components/TransactionModal'
import { UiButton } from '@/components/ui/UiButton'
import { UiModal } from '@/components/ui/UiModal'
import { useBorrowerFactory } from '@/hooks/useBorrowerFactory'
import { useFreezeViewWhileOpen } from '@/hooks/useFreezeViewWhileOpen'
import { useProtocolAction } from '@/hooks/useProtocolAction'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'

/** The action the deployed document declares for bringing a factory into existence. */
const CREATE_FACTORY = 'CreateFactory'

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
  const { refetchFactory, scriptPubkey } = useBorrowerFactory()
  const performProtocolAction = useProtocolAction()
  const { addPendingTx, addSurfaceToast } = usePendingTransactions()
  const { mutate, reset, data, status } = useMutation({
    // The protocol's own factory creation, which is what this dapp calls a borrower account.
    // Its three parameters are stated by the deployment and left to it.
    mutationFn: () => performProtocolAction({ action: CREATE_FACTORY }),
    onSuccess: result => {
      void addPendingTx({
        txid: result.txid,
        kind: 'create_borrower_account',
        walletScriptPubkey: scriptPubkey ?? '',
      })
    },
  })

  const liveTxid = data?.txid ?? null
  const view = useFreezeViewWhileOpen(isOpen, {
    status,
    txid: liveTxid,
  })

  const handleClose = () => {
    if (data?.txid) addSurfaceToast(data.txid)
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
          <span className='bg-accent-soft text-accent-soft-foreground flex size-10 items-center justify-center rounded-full'>
            <UserIcon className='size-5' />
          </span>
          Create Borrower Account
        </span>
      }
      footer={
        <>
          <UiButton variant='secondary' onPress={handleClose}>
            Cancel
          </UiButton>
          <UiButton
            variant='primary'
            onPress={() => {
              mutate()
            }}
          >
            Create
          </UiButton>
        </>
      }
    >
      <p className='text-muted text-sm'>Required to create borrow offers.</p>
    </UiModal>
  )
}
