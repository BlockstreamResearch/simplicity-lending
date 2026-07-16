import type { SVGProps } from 'react'

// SideSwap brand mark (fills are intentional, not currentColor).
export default function SideSwapIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      role='presentation'
      focusable='false'
      aria-hidden='true'
      xmlns='http://www.w3.org/2000/svg'
      {...props}
    >
      <path
        fillRule='evenodd'
        clipRule='evenodd'
        d='M20.8211 17.3541L19.9296 16.5693C18.0476 19.4839 14.7006 21.1738 11.1821 20.9858C7.66352 20.7979 4.52448 18.7616 2.97807 15.6639C5.97231 19.1224 13.6672 18.3889 18.3834 15.2078L17.0237 14.0172C20.8668 12.4894 21.7457 10.381 21.7642 10.3354C22.2792 12.7127 21.9449 15.1908 20.8173 17.3561'
        fill='white'
      />
      <path
        fillRule='evenodd'
        clipRule='evenodd'
        d='M2.00002 11.5019C1.99565 9.21668 2.83789 7.00739 4.37075 5.28312L4.38241 5.27171C4.43486 5.2109 4.4873 5.15104 4.54266 5.09404C4.63978 4.98857 4.7369 4.88595 4.84374 4.78429C6.66426 3.00162 9.1344 2 11.7102 2C14.2859 2 16.7561 3.00162 18.5767 4.78429C22.9335 9.04571 17.3257 14.5538 10.4301 14.3428V16.2013L4.49313 12.0359L10.4301 7.87039V9.74692C12.392 9.45525 15.8563 8.59251 14.8414 6.18101C13.4457 2.84977 3.63264 3.6156 2.00002 11.5019Z'
        fill='white'
      />
    </svg>
  )
}
