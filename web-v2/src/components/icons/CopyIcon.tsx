import type { SVGProps } from 'react'

export default function CopyIcon(props: SVGProps<SVGSVGElement>) {
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
      <rect
        x='9'
        y='9'
        width='13'
        height='13'
        rx='2'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}
