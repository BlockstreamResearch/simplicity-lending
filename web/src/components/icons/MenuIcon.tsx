import type { SVGProps } from 'react'

export default function MenuIcon(props: SVGProps<SVGSVGElement>) {
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
      <rect x='4' y='5' width='16' height='2' rx='1' fill='currentColor' />
      <rect x='4' y='11' width='16' height='2' rx='1' fill='currentColor' />
      <rect x='4' y='17' width='16' height='2' rx='1' fill='currentColor' />
    </svg>
  )
}
