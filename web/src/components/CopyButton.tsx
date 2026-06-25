import CheckIcon from '@/components/icons/CheckIcon'
import CopyIcon from '@/components/icons/CopyIcon'
import { UiButton } from '@/components/ui/UiButton'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'

interface CopyButtonProps {
  value: string
  'aria-label'?: string
}

export default function CopyButton({ value, 'aria-label': ariaLabel = 'Copy' }: CopyButtonProps) {
  const [copied, copy] = useCopyToClipboard()

  return (
    <UiButton
      variant='ghost'
      isIconOnly
      size='sm'
      aria-label={ariaLabel}
      onPress={() => copy(value)}
    >
      {copied ? <CheckIcon className='size-4' /> : <CopyIcon className='size-4' />}
    </UiButton>
  )
}
