import type { SVGProps } from 'react'

export default function ArrowDownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      fill='none'
      role='presentation'
      focusable='false'
      aria-hidden='true'
      viewBox='0 0 16 16'
      xmlns='http://www.w3.org/2000/svg'
      {...props}
    >
      <path
        fillRule='evenodd'
        clipRule='evenodd'
        d='M8 1.25C8.41421 1.25 8.75 1.58579 8.75 2L8.75 12.1893L11.4697 9.46967C11.7626 9.17678 12.2374 9.17678 12.5303 9.46967C12.8232 9.76256 12.8232 10.2374 12.5303 10.5303L8.53033 14.5303C8.23744 14.8232 7.76256 14.8232 7.46967 14.5303L3.46967 10.5303C3.17678 10.2374 3.17678 9.76256 3.46967 9.46967C3.76256 9.17678 4.23744 9.17678 4.53033 9.46967L7.25 12.1893L7.25 2C7.25 1.58579 7.58579 1.25 8 1.25Z'
        fill='currentColor'
      />
    </svg>
  )
}
