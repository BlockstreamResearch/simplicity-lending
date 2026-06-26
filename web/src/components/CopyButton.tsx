import CheckIcon from '@/components/icons/CheckIcon'
import CopyIcon from '@/components/icons/CopyIcon'
import { UiButton, type UiButtonProps } from '@/components/ui/UiButton'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'

interface CopyButtonProps extends UiButtonProps {
  value: string
}

export default function CopyButton({
  value,
  variant = 'ghost',
  size = 'sm',
  isIconOnly = true,
  'aria-label': ariaLabel = 'Copy',
  ...props
}: CopyButtonProps) {
  const [copied, copy] = useCopyToClipboard()

  return (
    <UiButton
      variant={variant}
      isIconOnly={isIconOnly}
      size={size}
      aria-label={ariaLabel}
      {...props}
      onPress={() => copy(value)}
    >
      {copied ? <CheckIcon className='size-4' /> : <CopyIcon className='size-4' />}
    </UiButton>
  )
}
