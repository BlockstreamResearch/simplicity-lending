import type { AriaRole, ReactNode } from 'react'

import CircleExclamationIcon from '@/components/icons/CircleExclamationIcon'
import CircleInfoIcon from '@/components/icons/CircleInfoIcon'
import TriangleExclamationIcon from '@/components/icons/TriangleExclamationIcon'
import { UiButton } from '@/components/ui/UiButton'

type CardAlertVariant = 'warning' | 'accent' | 'danger'

const FILLED_VARIANT_CONFIG: Record<
  CardAlertVariant,
  { className: string; buttonVariant: 'danger' | 'primary' }
> = {
  warning: { className: 'border-warning bg-warning-soft text-warning', buttonVariant: 'primary' },
  accent: { className: 'border-accent bg-accent-soft text-accent', buttonVariant: 'primary' },
  danger: { className: 'border-danger bg-danger-soft text-danger', buttonVariant: 'danger' },
}

export default function CardAlert({
  variant,
  title,
  description,
  actionLabel,
  actionIcon,
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
  actionIcon?: ReactNode
  isDisabled?: boolean
  isFilled?: boolean
  role?: AriaRole
  clampDescription?: boolean
  onAction?: () => void
}) {
  if (isFilled) {
    const filledConfig = FILLED_VARIANT_CONFIG[variant]
    return (
      <div
        role={role}
        className={`flex items-center gap-3 rounded-sm border-2 p-2.5 text-sm ${filledConfig.className}`}
      >
        <TriangleExclamationIcon className='size-6 shrink-0' />
        <div className='flex flex-1 flex-col gap-3 sm:flex-row sm:items-center'>
          <div className='flex flex-1 flex-col'>
            <p className='font-bold'>{title}</p>
            <p className='font-medium'>{description}</p>
          </div>
          {actionLabel && (
            <UiButton
              className='gap-1 self-start sm:self-auto'
              size='sm'
              variant={filledConfig.buttonVariant}
              onPress={onAction}
              isDisabled={isDisabled}
            >
              {actionLabel}
              {actionIcon}
            </UiButton>
          )}
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
