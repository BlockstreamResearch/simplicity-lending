import type { ReactNode } from 'react'

import CircleInfoIcon from '@/components/icons/CircleInfoIcon'

export interface DetailRow {
  label: string
  value: ReactNode
}

interface DetailsPanelProps {
  title?: string
  rows: DetailRow[]
  bordered?: boolean
}

export default function DetailsPanel({ title, rows, bordered }: DetailsPanelProps) {
  return (
    <section
      className={`bg-surface-secondary flex flex-col gap-3 rounded-xl p-6 ${
        bordered ? 'border-danger border' : ''
      }`}
    >
      {title && <h4 className='text-muted text-xs'>{title}</h4>}
      <div className='flex flex-col'>
        {rows.map((row, i) => (
          <div
            key={row.label}
            className={`flex items-center justify-between py-3 text-sm ${
              i > 0 ? 'border-separator border-t' : ''
            }`}
          >
            <span className='text-foreground flex items-center gap-2 font-medium'>
              {row.label}
              <CircleInfoIcon className='text-muted size-3' />
            </span>
            <span className='font-medium'>{row.value}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
