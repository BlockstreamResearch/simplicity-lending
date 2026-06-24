import type { SVGProps } from 'react'

export default function XIcon(props: SVGProps<SVGSVGElement>) {
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
      <path
        d='M18 6L6 18M6 6l12 12'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}
