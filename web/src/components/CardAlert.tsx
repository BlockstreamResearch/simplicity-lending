import type { AriaRole } from 'react'

import CircleExclamationIcon from '@/components/icons/CircleExclamationIcon'
import CircleInfoIcon from '@/components/icons/CircleInfoIcon'
import TriangleExclamationIcon from '@/components/icons/TriangleExclamationIcon'
import { UiButton } from '@/components/ui/UiButton'

type CardAlertVariant = 'warning' | 'accent' | 'danger'

const FILLED_VARIANT_CLASS_CONFIG: Record<CardAlertVariant, string> = {
  warning: 'border-warning bg-warning-soft text-warning',
  accent: 'border-accent bg-accent-soft text-accent',
  danger: 'border-danger bg-danger-soft text-danger',
}

export default function CardAlert({
  variant,
  title,
  description,
  actionLabel,
  isDisabled,
  isFilled,
  role,
  clampDescription = true,
  onAction,
}: {
  variant: CardAlertVariant
  title: string
  description: string
  actionLabel?: string
  isDisabled?: boolean
  isFilled?: boolean
  role?: AriaRole
  clampDescription?: boolean
  onAction?: () => void
}) {
  if (isFilled) {
    return (
      <div
        role={role}
        className={`flex items-center gap-3 rounded-sm border-2 p-2.5 text-sm ${FILLED_VARIANT_CLASS_CONFIG[variant]}`}
      >
        <TriangleExclamationIcon className='size-6 shrink-0' />
        <div className='flex flex-1 flex-col'>
          <p className='font-bold'>{title}</p>
          <p className='font-medium'>{description}</p>
        </div>
      </div>
    )
  }

  const isWarning = variant === 'warning'
  const isDanger = variant === 'danger'
  const Icon = isWarning || isDanger ? CircleExclamationIcon : CircleInfoIcon
  const severityClass = isDanger ? 'text-danger' : isWarning ? 'text-warning' : 'text-accent'

  return (
    <div
      role={role}
      className='bg-surface shadow-surface flex min-h-21 gap-2.5 rounded-xl px-4 pb-3'
    >
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
      {actionLabel && (
        <UiButton
          size='sm'
          variant='secondary'
          className='shrink-0 self-center'
          onPress={onAction}
          isDisabled={isDisabled}
        >
          {actionLabel}
        </UiButton>
      )}
    </div>
  )
}
