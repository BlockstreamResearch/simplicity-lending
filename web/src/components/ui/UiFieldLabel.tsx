import InfoTooltip from '@/components/InfoTooltip'

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
      {tooltip && <InfoTooltip content={tooltip} className='text-muted' />}
    </span>
  )
}
