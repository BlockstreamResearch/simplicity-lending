import ArrowsRotateIcon from '@/components/icons/ArrowsRotateIcon'
import CircleExclamationIcon from '@/components/icons/CircleExclamationIcon'
import { UiButton } from '@/components/ui/UiButton'
import { ErrorHandler } from '@/utils/errorHandler'

interface OffersLoadErrorProps {
  error: Error
  onRetry: () => void
}

export function OffersLoadError({ error, onRetry }: OffersLoadErrorProps) {
  return (
    <div className='bg-surface border-muted flex w-full flex-col items-center gap-3 rounded border border-dashed px-6 py-12 text-center'>
      <span className='bg-background border-border text-muted-secondary flex size-11 items-center justify-center rounded-full border'>
        <CircleExclamationIcon className='size-5' />
      </span>

      <div className='flex max-w-xs flex-col gap-1'>
        <p className='text-foreground text-sm font-semibold'>Couldn’t load offers</p>
        <p className='text-muted wrap-break-word text-sm'>{ErrorHandler.describe(error)}</p>
      </div>

      <UiButton size='sm' variant='secondary' className='mt-1' onPress={onRetry}>
        <ArrowsRotateIcon className='size-4' />
        Try again
      </UiButton>
    </div>
  )
}
