import type { SVGProps } from 'react'

export default function CircleDashedIcon(props: SVGProps<SVGSVGElement>) {
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
      <circle
        cx='12'
        cy='12'
        r='8'
        stroke='currentColor'
        strokeWidth='1.75'
        strokeLinecap='round'
        strokeDasharray='3 3'
      />
    </svg>
  )
}
