import { Skeleton } from '@heroui/react'
import type { ReactNode } from 'react'

export function DataRow({
  label,
  value,
  isLoading,
}: {
  label: string
  value: ReactNode
  isLoading?: boolean
}) {
  return (
    <div className='text-muted flex items-center justify-between text-base'>
      <span>{label}</span>
      {isLoading ? <Skeleton className='h-4 w-20 rounded' /> : <span>{value}</span>}
    </div>
  )
}
