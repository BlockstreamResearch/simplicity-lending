import type { SVGProps } from 'react'

// A short numbered word list — a seed phrase is literally a list of words.
export default function SeedIcon(props: SVGProps<SVGSVGElement>) {
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
      <circle cx='4' cy='5.5' r='1.25' fill='currentColor' />
      <circle cx='4' cy='10' r='1.25' fill='currentColor' />
      <circle cx='4' cy='14.5' r='1.25' fill='currentColor' />
      <path
        d='M7.5 5.5H16.5M7.5 10H14M7.5 14.5H15.5'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeLinecap='round'
      />
    </svg>
  )
}
