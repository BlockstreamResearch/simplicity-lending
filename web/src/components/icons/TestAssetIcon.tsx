import type { SVGProps } from 'react'

// Generic badge for the liquidtestnet TEST asset. Deliberately unbranded so it isn't mistaken
// for a real stablecoin. Multi-color, so fills are intentional (not currentColor).
export default function TestAssetIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox='0 0 16 16'
      fill='none'
      role='presentation'
      focusable='false'
      aria-hidden='true'
      xmlns='http://www.w3.org/2000/svg'
      {...props}
    >
      <circle cx='8' cy='8' r='6.67' fill='#71717A' />
      <path d='M5.33 5.33H10.67V6.67H8.67V11.33H7.33V6.67H5.33V5.33Z' fill='white' />
    </svg>
  )
}
