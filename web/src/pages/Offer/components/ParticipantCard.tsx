import { Chip } from '@heroui/react'
import type { ReactNode } from 'react'

import UserIcon from '@/components/icons/UserIcon'

interface ParticipantCardProps {
  title: string
  subtitle: string
  amountLabel: string
  amount: ReactNode
  caption?: string
  isYou?: boolean
  isPlaceholder?: boolean
}

export default function ParticipantCard({
  title,
  subtitle,
  amountLabel,
  amount,
  caption,
  isYou,
  isPlaceholder,
}: ParticipantCardProps) {
  return (
    <div
      className={`flex min-w-0 flex-1 flex-col gap-2 rounded-2xl p-4 ${
        isPlaceholder ? '' : 'bg-surface'
      }`}
    >
      <div className='flex items-start justify-between gap-2'>
        <div className='flex min-w-0 items-center gap-2.5'>
          <span
            aria-hidden='true'
            className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
              isPlaceholder ? 'border-muted border border-dashed' : 'bg-default text-muted'
            }`}
          >
            {!isPlaceholder && <UserIcon className='size-4' />}
          </span>
          <div className='flex min-w-0 flex-col'>
            <span className={`font-medium ${isPlaceholder ? 'text-muted' : 'text-foreground'}`}>
              {title}
            </span>
            <span className='text-muted truncate text-xs'>{subtitle}</span>
          </div>
        </div>
        {isYou && (
          <Chip variant='soft' size='sm'>
            You
          </Chip>
        )}
      </div>
      <span className='text-muted text-sm'>{amountLabel}</span>
      <p className={`text-xl font-semibold break-all ${isPlaceholder ? 'text-muted' : ''}`}>
        {amount}
      </p>
      {caption && <span className='text-muted text-xs'>{caption}</span>}
    </div>
  )
}
