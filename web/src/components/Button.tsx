import type { ButtonHTMLAttributes, AnchorHTMLAttributes } from 'react'

const primary =
  'rounded-lg bg-[#5F3DC4] text-sm font-medium text-white hover:bg-[#4f36a8] focus:ring-2 focus:ring-[#5F3DC4] focus:ring-offset-1 disabled:opacity-50 disabled:pointer-events-none'
const secondary =
  'rounded-lg border-2 border-[#5F3DC4] bg-transparent text-sm font-medium text-[#5F3DC4] hover:bg-[#5F3DC4]/10 disabled:opacity-50 disabled:pointer-events-none'
const neutral =
  'rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400 disabled:opacity-50 disabled:pointer-events-none'
const neutralIcon = 'rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700'

const sizeClasses = {
  sm: 'px-3 py-1.5',
  md: 'px-4 py-2',
  lg: 'px-4 py-2.5',
  icon: 'p-1.5',
  iconSm: 'p-1',
} as const

type Size = keyof typeof sizeClasses

type ButtonBaseProps = {
  size?: Size
  className?: string
  children: React.ReactNode
}

export function ButtonPrimary({
  size = 'md',
  className = '',
  children,
  ...props
}: ButtonBaseProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`${primary} ${sizeClasses[size]} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  )
}

export function ButtonSecondary({
  size = 'md',
  className = '',
  children,
  ...props
}: ButtonBaseProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`${secondary} ${sizeClasses[size]} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  )
}

export function ButtonNeutral({
  size = 'md',
  className = '',
  children,
  ...props
}: ButtonBaseProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`${neutral} ${sizeClasses[size]} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  )
}

export function ButtonIconNeutral({
  className = '',
  title,
  'aria-label': ariaLabel,
  children,
  ...props
}: Omit<ButtonBaseProps, 'size'> &
  ButtonHTMLAttributes<HTMLButtonElement> & { title?: string; 'aria-label'?: string }) {
  return (
    <button
      type="button"
      className={`${neutralIcon} ${className}`.trim()}
      title={title}
      aria-label={ariaLabel}
      {...props}
    >
      {children}
    </button>
  )
}

/** Secondary style for links (e.g. "View in explorer") */
export function LinkSecondary({
  className = '',
  children,
  ...props
}: ButtonBaseProps & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      className={`inline-flex shrink-0 items-center justify-center rounded-lg border-2 border-[#5F3DC4] bg-transparent text-[#5F3DC4] hover:bg-[#5F3DC4]/10 ${sizeClasses.icon} ${className}`.trim()}
      {...props}
    >
      {children}
    </a>
  )
}
