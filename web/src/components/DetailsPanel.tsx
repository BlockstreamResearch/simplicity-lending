import { Tooltip } from '@heroui/react'
import type { ReactNode } from 'react'

import CopyButton from '@/components/CopyButton'
import CircleInfoIcon from '@/components/icons/CircleInfoIcon'

export interface DetailRow {
  label: string
  value: ReactNode
  copyValue?: string
  tooltip?: string
  multilineTooltip?: boolean
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
            className={`flex items-center justify-between gap-3 py-3 text-sm ${
              i > 0 ? 'border-separator border-t' : ''
            }`}
          >
            <span className='text-foreground inline-flex min-w-0 items-center gap-1 font-medium'>
              {row.label}
              {row.tooltip && (
                <Tooltip delay={0}>
                  <Tooltip.Trigger className='text-muted inline-flex shrink-0 cursor-help'>
                    <CircleInfoIcon className='size-3' />
                  </Tooltip.Trigger>
                  <Tooltip.Content
                    className={`text-muted ${
                      row.multilineTooltip ? 'whitespace-pre' : 'max-w-64 break-normal!'
                    }`}
                  >
                    {row.tooltip}
                  </Tooltip.Content>
                </Tooltip>
              )}
            </span>
            <span className='flex shrink-0 items-center gap-1 font-medium'>
              {row.value}
              {row.copyValue && <CopyButton value={row.copyValue} />}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
