import { buttonVariants } from '@heroui/react'
import { Link } from 'react-router-dom'

import ArrowSquareOutIcon from '@/components/icons/ArrowSquareOutIcon'
import { RoutePath } from '@/constants/routes'

import { LandingContainer } from './LandingContainer'

const ABOUT_SIMPLICITY_URL = 'https://simplicity-lang.org/'

export function LandingHeader() {
  return (
    <header className='pt-6 pb-6 lg:pt-10'>
      <LandingContainer className='flex flex-wrap items-center justify-between gap-4'>
        <Link to={RoutePath.Landing} className='flex flex-col gap-1.5'>
          <h1 className='text-3xl leading-none font-black tracking-tight uppercase sm:text-4xl lg:text-[43px] lg:leading-10'>
            Lending
          </h1>
          <span className='text-foreground text-xs font-medium tracking-[0.16em] uppercase'>
            powered by Simplicity
          </span>
        </Link>

        <div className='flex items-center gap-3'>
          <a
            className={`${buttonVariants({ variant: 'ghost' })} hidden sm:inline-flex`}
            href={ABOUT_SIMPLICITY_URL}
            target='_blank'
            rel='noopener noreferrer'
          >
            About Simplicity
            <ArrowSquareOutIcon className='size-4' />
          </a>
          <Link to={RoutePath.Dashboard} className={buttonVariants({ variant: 'primary' })}>
            Launch App
          </Link>
        </div>
      </LandingContainer>
    </header>
  )
}
