import type { SVGProps } from 'react'

export default function ArrowsRotateIcon(props: SVGProps<SVGSVGElement>) {
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
        d='M20 4v6h-6M4 20v-6h6M4 10a8 8 0 0 1 14-3l2 3M20 14a8 8 0 0 1-14 3l-2-3'
        stroke='currentColor'
        strokeWidth='1.75'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}
