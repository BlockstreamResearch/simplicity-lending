import { Chip } from '@heroui/react'
import type { ReactNode } from 'react'

import type { ParticipantType } from '@/api/indexer/schemas'

import { ACTOR_LABEL } from './constants'

interface ActivityEventHeaderProps {
  title: string
  icon: ReactNode
  tone: string
  caption: string
  actor?: ParticipantType
}

export default function ActivityEventHeader({
  title,
  icon,
  tone,
  caption,
  actor,
}: ActivityEventHeaderProps) {
  return (
    <span className='flex min-w-0 items-center gap-3'>
      <span
        aria-hidden='true'
        className={`flex size-9 shrink-0 items-center justify-center rounded-full ${tone}`}
      >
        {icon}
      </span>
      <span className='flex min-w-0 flex-col text-left'>
        <span className='flex flex-wrap items-center gap-x-1.5'>
          <span className='text-h4 text-foreground'>{title}</span>
          {actor && (
            <Chip
              size='sm'
              variant='tertiary'
              className='border-muted text-muted border px-2 py-0.5'
            >
              {ACTOR_LABEL[actor]}
            </Chip>
          )}
        </span>
        <span className='text-muted text-xs font-normal'>{caption}</span>
      </span>
    </span>
  )
}
