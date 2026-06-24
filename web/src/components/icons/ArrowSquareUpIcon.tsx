import type { SVGProps } from 'react'

export default function ArrowSquareUpIcon(props: SVGProps<SVGSVGElement>) {
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
      <rect x='3' y='3' width='18' height='18' rx='3' stroke='currentColor' strokeWidth='1.75' />
      <path
        d='M12 16V8m0 0-3 3m3-3 3 3'
        stroke='currentColor'
        strokeWidth='1.75'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}
