import type { ReactNode } from 'react'

interface ActivityEventHeaderProps {
  title: string
  icon: ReactNode
  tone: string
  caption: string
}

export default function ActivityEventHeader({
  title,
  icon,
  tone,
  caption,
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
        <span className='text-h4 text-foreground'>{title}</span>
        <span className='text-muted text-xs font-normal'>{caption}</span>
      </span>
    </span>
  )
}
