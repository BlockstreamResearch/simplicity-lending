import type { ElementType, ReactNode } from 'react'

export function LandingContainer({
  as: Tag = 'div',
  className = '',
  children,
}: {
  as?: ElementType
  className?: string
  children: ReactNode
}) {
  return (
    <Tag className={`mx-auto w-full max-w-7xl px-4 sm:px-8 lg:px-20 ${className}`}>{children}</Tag>
  )
}
