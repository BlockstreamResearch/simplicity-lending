import CircleDashedIcon from '@/components/icons/CircleDashedIcon'
import TransactionModal from '@/components/TransactionModal'
import { UiButton } from '@/components/ui/UiButton'
import { UiModal } from '@/components/ui/UiModal'
import { useBorrowerAccount } from '@/hooks/useBorrowerAccount'
import { useTransaction } from '@/hooks/useTransaction'

interface CreateBorrowerAccountModalProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}

export default function CreateBorrowerAccountModal({
  isOpen,
  onOpenChange,
}: CreateBorrowerAccountModalProps) {
  const { createBorrowerAccount } = useBorrowerAccount()
  const { phase, txid, error, execute, resetTx } = useTransaction()

  const handleClose = () => {
    resetTx()
    onOpenChange(false)
  }

  const handleCreate = () => {
    execute(async () => {
      const result = await createBorrowerAccount()
      return result.txid
    })
  }

  if (phase !== 'idle') {
    return (
      <TransactionModal
        isOpen={isOpen}
        eyebrow='New Borrower Account'
        phase={phase}
        txid={txid}
        errorMessage={error}
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
          <UiButton variant='primary' onPress={handleCreate}>
            Create
          </UiButton>
        </>
      }
    >
      <p className='text-muted text-sm'>Required to create borrow offers.</p>
    </UiModal>
  )
}
