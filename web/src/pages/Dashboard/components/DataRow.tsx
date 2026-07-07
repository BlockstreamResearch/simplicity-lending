import { Skeleton } from '@heroui/react'
import type { ReactNode } from 'react'

export function DataRow({
  label,
  value,
  icon,
  isLoading,
}: {
  label: string
  value: ReactNode
  icon?: ReactNode
  isLoading?: boolean
}) {
  return (
    <div className='flex flex-col gap-2 [&:last-child>.border-t]:hidden'>
      <div className='text-muted flex items-center justify-between gap-3 text-base'>
        <span className='flex min-w-0 items-center gap-1.5'>
          {icon}
          {label}
        </span>
        {isLoading ? (
          <Skeleton className='h-4 w-20 shrink-0 rounded' />
        ) : (
          <span className='text-foreground shrink-0 font-medium'>{value}</span>
        )}
      </div>
      <div className='border-separator border-t' />
    </div>
  )
}
