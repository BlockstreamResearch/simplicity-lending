import { useMutation } from '@tanstack/react-query'

import { broadcastTx } from '@/api/esplora/methods'
import CircleDashedIcon from '@/components/icons/CircleDashedIcon'
import TransactionModal from '@/components/TransactionModal'
import { getDefaultTransactionSteps } from '@/components/TransactionStepper/transactionSteps'
import { UiButton } from '@/components/ui/UiButton'
import { UiModal } from '@/components/ui/UiModal'
import { useBorrowerAccount } from '@/hooks/useBorrowerAccount'
import { useFreezeViewWhileOpen } from '@/hooks/useFreezeViewWhileOpen'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useTxProgress } from '@/providers/txProgress/useTxProgress'
import { useWallet } from '@/providers/wallet/useWallet'

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
  const { signPset, signerType } = useWallet()
  const { prepare, start, fail } = useTxProgress()
  const { addPendingTx, addSurfaceToast } = usePendingTransactions()
  const { mutate, reset, data, status } = useMutation({
    mutationFn: async () => {
      try {
        const advance = await start(getDefaultTransactionSteps(signerType))
        const { pset, finalize } = await createBorrowerAccount()

        await advance('signing')
        const signedPset = await signPset(pset)

        await advance('finalizing')
        const { finalizedTx, summary } = finalize(signedPset)

        await advance('broadcasting')
        const txid = await broadcastTx(finalizedTx.toString())

        return { txid, summary }
      } catch (err) {
        fail(err)
        throw err
      }
    },
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
          <UiButton
            variant='primary'
            onPress={() => {
              prepare()
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
