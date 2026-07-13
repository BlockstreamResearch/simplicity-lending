import type { SVGProps } from 'react'

// Blockstream Jade brand mark, white-on-accent variant (fills are intentional, not currentColor).
export default function JadeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
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
        d='M11.4005 15.765L10.0096 14.406L9.78577 14.1982L9.19424 13.5907L8.21903 12.5835H2L11.4005 21.968V15.765Z'
        fill='white'
      />
      <path
        fillRule='evenodd'
        clipRule='evenodd'
        d='M12.5674 22.016L21.9679 12.5835H15.7648L14.4219 13.9904L14.2141 14.2142L13.5906 14.7897L12.5674 15.7809V22.016Z'
        fill='white'
      />
      <path
        fillRule='evenodd'
        clipRule='evenodd'
        d='M12.5674 2V8.20304L13.9743 9.57794L14.1981 9.78577L14.7896 10.3933L15.7808 11.4165H21.9998L12.5674 2Z'
        fill='white'
      />
      <path
        fillRule='evenodd'
        clipRule='evenodd'
        d='M11.4005 2L2 11.4165H8.20304L9.57794 9.99361L9.78577 9.76978L10.3933 9.17826L11.4005 8.20304V2Z'
        fill='white'
      />
    </svg>
  )
}
