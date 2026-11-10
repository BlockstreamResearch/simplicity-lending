import { buttonVariants } from '@heroui/react'
import { Link } from 'react-router-dom'

import { RoutePath } from '@/constants/routes'

import { HeroDemoVideo } from './HeroDemoVideo'
import { LandingContainer } from './LandingContainer'

export function Hero() {
  return (
    <LandingContainer
      className='flex flex-col items-center gap-8 pt-8 pb-12 sm:gap-10 sm:py-12 lg:flex-row lg:py-20'
      as='section'
    >
      <div className='order-1 flex w-full min-w-0 max-w-135 flex-col gap-6'>
        <div className='text-foreground flex flex-col gap-6'>
          <p className='text-[28px] leading-9 font-semibold sm:text-[36px] sm:leading-10'>
            The First Self-Custodial Bitcoin Lending Platform
          </p>
          <p className='text-base'>
            Self-custodial bitcoin loans built on mathematically provable smart contracts. Borrow
            against your bitcoin without selling it or triggering a taxable event. Your collateral
            stays in the contract, not in someone else&apos;s hands.
          </p>
        </div>
        <div className='flex flex-wrap items-start gap-3'>
          <Link to={RoutePath.Dashboard} className={buttonVariants({ variant: 'primary' })}>
            Try It on Testnet
          </Link>
        </div>
      </div>

      <div className='order-2 w-full min-w-0 max-w-135'>
        <HeroDemoVideo />
      </div>
    </LandingContainer>
  )
}
