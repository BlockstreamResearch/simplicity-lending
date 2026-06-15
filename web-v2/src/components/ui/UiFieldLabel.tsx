import CircleInfoIcon from '@/components/icons/CircleInfoIcon'

export function UiFieldLabel({ children, required }: { children: string; required?: boolean }) {
  return (
    <span className='inline-flex items-center gap-1'>
      {children}
      {required && <span className='text-danger'>*</span>}
      <CircleInfoIcon className='text-muted size-3' />
    </span>
  )
}
