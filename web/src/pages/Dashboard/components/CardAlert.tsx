import CircleExclamationIcon from '@/components/icons/CircleExclamationIcon'
import CircleInfoIcon from '@/components/icons/CircleInfoIcon'
import { UiButton } from '@/components/ui/UiButton'

export default function CardAlert({
  variant,
  title,
  description,
  actionLabel,
  isDisabled,
  clampDescription = true,
  onAction,
}: {
  variant: 'warning' | 'accent' | 'danger'
  title: string
  description: string
  actionLabel: string
  isDisabled?: boolean
  clampDescription?: boolean
  onAction?: () => void
}) {
  const isWarning = variant === 'warning'
  const isDanger = variant === 'danger'
  const Icon = isWarning || isDanger ? CircleExclamationIcon : CircleInfoIcon
  const severityClass = isDanger ? 'text-danger' : isWarning ? 'text-warning' : 'text-accent'
  return (
    <div className='bg-surface shadow-surface flex min-h-21 gap-2.5 rounded-xl px-4 pb-3'>
      <Icon className={`mt-3 size-5 shrink-0 ${severityClass}`} />
      <div className='min-w-0 flex-1 pt-3'>
        <p
          className={`text-sm font-medium ${isDanger ? 'text-danger' : isWarning ? 'text-warning' : 'text-foreground'}`}
        >
          {title}
        </p>
        <p className={`text-muted text-sm ${clampDescription ? 'line-clamp-2' : ''}`}>
          {description}
        </p>
      </div>
      <UiButton
        size='sm'
        variant='secondary'
        className='shrink-0 self-center'
        onPress={onAction}
        isDisabled={isDisabled}
      >
        {actionLabel}
      </UiButton>
    </div>
  )
}
