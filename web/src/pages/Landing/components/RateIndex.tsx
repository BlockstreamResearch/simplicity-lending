import { buttonVariants } from '@heroui/react'
import { Link } from 'react-router-dom'

import { RoutePath } from '@/constants/routes'

import { LandingContainer } from './LandingContainer'
import { Reveal } from './Reveal'

export function RateIndex() {
  return (
    <section className='bg-surface-secondary'>
      <LandingContainer className='flex flex-col items-center gap-10 py-12 text-center lg:py-20'>
        <Reveal className='flex max-w-200 flex-col items-center gap-4'>
          <div className='flex flex-col gap-4'>
            <p className='text-accent text-xs font-bold'>RATE INDEX</p>
            <p className='text-h2'>Transparent Rate Discovery</p>
          </div>
          <p className='text-foreground text-sm'>
            Choose a rate that fits your borrowing needs. The on-chain rate index shows real market
            pricing by day, month, and year. You pick the terms that work for you, not terms
            dictated by a platform.
          </p>
        </Reveal>
        <Reveal delay={0.15}>
          <Link to={RoutePath.Borrow} className={buttonVariants({ variant: 'primary' })}>
            Borrow Offers
          </Link>
        </Reveal>
      </LandingContainer>
    </section>
  )
}
