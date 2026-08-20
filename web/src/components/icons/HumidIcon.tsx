import type { SVGProps } from 'react'

// A puzzle piece — the mark every browser uses for an extension, which is what humid is.
export default function HumidIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      fill='none'
      role='presentation'
      focusable='false'
      aria-hidden='true'
      viewBox='0 0 20 20'
      xmlns='http://www.w3.org/2000/svg'
      {...props}
    >
      <path
        d='M8.125 2.5a1.875 1.875 0 0 1 3.75 0V3.75h2.5c.345 0 .625.28.625.625v2.5h1.25a1.875 1.875 0 0 1 0 3.75H15v2.5c0 .345-.28.625-.625.625h-2.5V15a1.875 1.875 0 0 1-3.75 0v-1.25h-2.5A.625.625 0 0 1 5 13.125v-2.5H3.75a1.875 1.875 0 0 1 0-3.75H5v-2.5c0-.345.28-.625.625-.625h2.5V2.5Z'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeLinejoin='round'
      />
    </svg>
  )
}
