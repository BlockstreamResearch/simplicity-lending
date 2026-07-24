import { Chip, Spinner, Tooltip } from '@heroui/react'

interface PendingBalanceBadgeProps {
  label: string
  tooltip: string
}

export default function PendingBalanceBadge({ label, tooltip }: PendingBalanceBadgeProps) {
  return (
    <Tooltip>
      <Tooltip.Trigger className='inline-flex shrink-0'>
        <Chip color='warning' variant='soft' size='sm'>
          <Spinner size='sm' color='current' className='size-3.5' />+{label}
        </Chip>
      </Tooltip.Trigger>
      <Tooltip.Content className='text-muted max-w-64 break-normal!'>{tooltip}</Tooltip.Content>
    </Tooltip>
  )
}
