import ChevronLeftIcon from '@/components/icons/ChevronLeftIcon'
import CircleExclamationIcon from '@/components/icons/CircleExclamationIcon'
import { UiButton } from '@/components/ui/UiButton'

interface ErrorScreenProps {
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
}

export function ErrorScreen({
  title,
  description,
  actionLabel = 'Back to home',
  onAction = () => {
    window.location.href = '/'
  },
}: ErrorScreenProps) {
  return (
    <main className='bg-background flex min-h-screen w-full items-center justify-center px-4'>
      <div className='bg-surface shadow-surface animate-modal-view-in flex w-full max-w-md flex-col items-center rounded-2xl p-8 text-center'>
        <span className='text-muted mb-7 text-xs font-bold tracking-widest uppercase'>Lending</span>

        <div className='flex flex-col items-center gap-6'>
          <span className='bg-danger/10 flex size-16 items-center justify-center rounded-full'>
            <span className='bg-danger/15 text-danger flex size-11 items-center justify-center rounded-full'>
              <CircleExclamationIcon className='size-6' />
            </span>
          </span>

          <div className='flex flex-col items-center gap-1.5'>
            <h1 className='text-2xl leading-none font-black tracking-tight uppercase'>{title}</h1>
            <p className='text-muted text-sm'>{description}</p>
          </div>

          <UiButton variant='primary' className='w-full' onPress={onAction}>
            <ChevronLeftIcon className='size-4' />
            {actionLabel}
          </UiButton>
        </div>
      </div>
    </main>
  )
}
