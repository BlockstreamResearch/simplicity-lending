import { buttonVariants } from '@heroui/react'
import { Link } from 'react-router-dom'

import { RoutePath } from '@/constants/routes'

import { LandingContainer } from './LandingContainer'

const ABOUT_SIMPLICITY_URL = 'https://simplicity-lang.org/'

const NAV = [
  { label: 'About', href: ABOUT_SIMPLICITY_URL },
  { label: 'Docs', href: ABOUT_SIMPLICITY_URL },
]

export function LandingFooter() {
  return (
    <LandingContainer
      className='flex flex-wrap items-center justify-between gap-6 py-10'
      as='footer'
    >
      <Link to={RoutePath.Landing} className='flex flex-col gap-1.5'>
        <p className='text-3xl leading-none font-black tracking-tight uppercase sm:text-4xl lg:text-[43px] lg:leading-10'>
          Lending
        </p>
        <span className='text-foreground text-xs font-medium tracking-[0.16em] uppercase'>
          powered by Simplicity
        </span>
      </Link>

      <nav className='flex flex-wrap items-center justify-center gap-1'>
        {NAV.map(({ label, href }) => (
          <a
            key={label}
            className={buttonVariants({ variant: 'ghost' })}
            href={href}
            target='_blank'
            rel='noopener noreferrer'
          >
            {label}
          </a>
        ))}
      </nav>

      <p className='text-muted text-sm'>
        © {new Date().getFullYear()} Simplicity. All rights reserved.
      </p>
    </LandingContainer>
  )
}
