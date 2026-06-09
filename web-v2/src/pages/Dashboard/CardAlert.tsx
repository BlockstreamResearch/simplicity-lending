import { UiButton } from '@/components/ui/UiButton'

export function CardAlert({
  variant,
  title,
  description,
  actionLabel,
  onAction,
  isDisabled,
}: {
  variant: 'warning' | 'accent'
  title: string
  description: string
  actionLabel: string
  onAction?: () => void
  isDisabled?: boolean
}) {
  const titleColor = variant === 'warning' ? 'text-warning' : 'text-foreground'
  return (
    <div className='bg-surface shadow-field flex items-center justify-between gap-4 rounded-lg p-4'>
      <div>
        <p className={`text-sm font-medium ${titleColor}`}>{title}</p>
        <p className='text-muted mt-1 text-sm'>{description}</p>
      </div>
      <UiButton
        size='sm'
        variant='primary'
        className='shrink-0'
        onPress={onAction}
        isDisabled={isDisabled}
      >
        {actionLabel}
      </UiButton>
    </div>
  )
}
