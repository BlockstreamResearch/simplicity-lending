import type { ComponentType, SVGProps } from 'react'

import CircleCheckIcon from '@/components/icons/CircleCheckIcon'
import CircleInfoIcon from '@/components/icons/CircleInfoIcon'
import XIcon from '@/components/icons/XIcon'

export type NotificationVariant = 'success' | 'danger' | 'warning' | 'info'

export interface NotificationAction {
  label: string
  onPress: () => void
}

interface NotificationProps {
  variant: NotificationVariant
  title: string
  description?: string
  action?: NotificationAction
  onDismiss: () => void
}

const VARIANT: Record<
  NotificationVariant,
  { Icon: ComponentType<SVGProps<SVGSVGElement>>; color: string; action: string }
> = {
  success: { Icon: CircleCheckIcon, color: 'text-success', action: 'bg-success text-foreground' },
  danger: { Icon: CircleInfoIcon, color: 'text-danger', action: 'bg-danger text-foreground' },
  warning: { Icon: CircleInfoIcon, color: 'text-warning', action: 'bg-warning text-foreground' },
  info: { Icon: CircleInfoIcon, color: 'text-accent', action: 'bg-accent text-foreground' },
}

export default function Notification({
  variant,
  title,
  description,
  action,
  onDismiss,
}: NotificationProps) {
  const { Icon, color, action: actionClass } = VARIANT[variant]

  return (
    <div className='bg-surface-secondary shadow-surface flex w-full items-center gap-3 rounded-2xl p-4'>
      <Icon className={`size-5 shrink-0 ${color}`} />
      <div className='flex flex-1 flex-col'>
        <span className={`text-sm font-medium ${color}`}>{title}</span>
        {description && <span className='text-muted text-sm'>{description}</span>}
      </div>
      {action ? (
        <button
          type='button'
          className={`shrink-0 rounded-sm px-4 py-2 text-sm font-medium ${actionClass}`}
          onClick={() => {
            action.onPress()
            onDismiss()
          }}
        >
          {action.label}
        </button>
      ) : (
        <button
          type='button'
          aria-label='Dismiss'
          className='text-muted hover:text-foreground shrink-0'
          onClick={onDismiss}
        >
          <XIcon className='size-4' />
        </button>
      )}
    </div>
  )
}
