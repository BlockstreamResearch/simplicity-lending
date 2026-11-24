import { Tooltip } from '@heroui/react'

import CircleInfoIcon from '@/components/icons/CircleInfoIcon'

interface InfoTooltipProps {
  content: string
  className?: string
  iconClassName?: string
  isMultiline?: boolean
}

export default function InfoTooltip({
  content,
  className = '',
  iconClassName = 'size-3',
  isMultiline,
}: InfoTooltipProps) {
  return (
    <Tooltip delay={0}>
      <Tooltip.Trigger className={`inline-flex cursor-help ${className}`}>
        <CircleInfoIcon className={iconClassName} />
      </Tooltip.Trigger>
      <Tooltip.Content
        className={`text-muted ${isMultiline ? 'whitespace-pre' : 'max-w-64 break-normal!'}`}
      >
        {content}
      </Tooltip.Content>
    </Tooltip>
  )
}
