import CircleInfoIcon from '@/components/icons/CircleInfoIcon'

export function UiFieldLabel({ children, optional }: { children: string; optional?: boolean }) {
  return (
    <span className='inline-flex items-center gap-1'>
      {children}
      {!optional && <span className='text-danger'>*</span>}
      <CircleInfoIcon className='text-muted size-3' />
    </span>
  )
}
