import type { SVGProps } from 'react'

export default function ArrowRightIcon(props: SVGProps<SVGSVGElement>) {
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
        d='M1.25 8C1.25 7.58579 1.58579 7.25 2 7.25L12.1893 7.25L9.46967 4.53033C9.17678 4.23744 9.17678 3.76256 9.46967 3.46967C9.76256 3.17678 10.2374 3.17678 10.5303 3.46967L14.5303 7.46967C14.8232 7.76256 14.8232 8.23744 14.5303 8.53033L10.5303 12.5303C10.2374 12.8232 9.76256 12.8232 9.46967 12.5303C9.17678 12.2374 9.17678 11.7626 9.46967 11.4697L12.1893 8.75L2 8.75C1.58579 8.75 1.25 8.41421 1.25 8Z'
        fill='currentColor'
      />
    </svg>
  )
}
