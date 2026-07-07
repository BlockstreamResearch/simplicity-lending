import { Tooltip } from '@heroui/react'

import CircleInfoIcon from '@/components/icons/CircleInfoIcon'

export function UiFieldLabel({
  children,
  required,
  tooltip,
}: {
  children: string
  required?: boolean
  tooltip?: string
}) {
  return (
    <span className='inline-flex items-center gap-1'>
      {children}
      {required && <span className='text-danger'>*</span>}
      {tooltip && (
        <Tooltip delay={0}>
          <Tooltip.Trigger className='text-muted inline-flex cursor-help'>
            <CircleInfoIcon className='size-3' />
          </Tooltip.Trigger>
          <Tooltip.Content className='max-w-64 break-normal!'>{tooltip}</Tooltip.Content>
        </Tooltip>
      )}
    </span>
  )
}
