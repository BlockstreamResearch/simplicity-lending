import type { SVGProps } from 'react'

export default function CircleExclamationIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      fill='none'
      role='presentation'
      focusable='false'
      aria-hidden='true'
      viewBox='0 0 24 24'
      xmlns='http://www.w3.org/2000/svg'
      {...props}
    >
      <circle cx='12' cy='12' r='9' stroke='currentColor' strokeWidth='1.5' />
      <path d='M12 8v4.5' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
      <circle cx='12' cy='16' r='1' fill='currentColor' />
    </svg>
  )
}
