import type { SVGProps } from 'react'

export default function UserIcon(props: SVGProps<SVGSVGElement>) {
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
      <circle cx='12' cy='8' r='4' stroke='currentColor' strokeWidth='1.75' />
      <path
        d='M4 20c0-4.418 3.582-8 8-8s8 3.582 8 8'
        stroke='currentColor'
        strokeWidth='1.75'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}
