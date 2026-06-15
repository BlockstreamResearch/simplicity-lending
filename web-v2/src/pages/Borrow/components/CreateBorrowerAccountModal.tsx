import { useMutation } from '@tanstack/react-query'

import CircleDashedIcon from '@/components/icons/CircleDashedIcon'
import TransactionModal from '@/components/TransactionModal'
import { UiButton } from '@/components/ui/UiButton'
import { UiModal } from '@/components/ui/UiModal'
import { useBorrowerAccount } from '@/hooks/useBorrowerAccount'

interface CreateBorrowerAccountModalProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}

export default function CreateBorrowerAccountModal({
  isOpen,
  onOpenChange,
}: CreateBorrowerAccountModalProps) {
  const { createBorrowerAccount } = useBorrowerAccount()
  const { mutate, reset, data, error, status } = useMutation<string, Error, () => Promise<string>>({
    mutationFn: fn => fn(),
  })

  const handleClose = () => {
    reset()
    onOpenChange(false)
  }

  const handleCreate = () => {
    mutate(async () => {
      const result = await createBorrowerAccount()
      return result.txid
    })
  }

  if (status !== 'idle') {
    return (
      <TransactionModal
        isOpen={isOpen}
        eyebrow='New Borrower Account'
        status={status}
        txid={data}
        errorMessage={error?.message}
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
