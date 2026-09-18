import CheckIcon from '@/components/icons/CheckIcon'

import { LandingContainer } from './LandingContainer'
import { LiveCreateOfferPreview } from './LiveCreateOfferPreview'
import { Reveal } from './Reveal'

const POINTS = [
  {
    title: 'No Taxable Event:',
    description:
      'Borrow against your bitcoin without selling it. Keep your exposure, get liquidity.',
  },
  {
    title: 'No Monthly Payments:',
    description: 'Repay on your schedule, anytime before the term expires.',
  },
  {
    title: 'Bitcoin-Native:',
    description: 'Built on the Liquid Network, a Bitcoin sidechain.',
  },
  {
    title: 'Deterministic Execution:',
    description: 'Every cost is known before execution.',
  },
]

export function ForBorrowers() {
  return (
    <LandingContainer
      className='relative flex min-h-146.25 flex-col items-center justify-center gap-10 py-12 lg:items-start lg:py-20'
      as='section'
    >
      <Reveal className='flex w-full flex-col gap-10 lg:max-w-[calc(100%-421px)]'>
        <div className='flex flex-col mx-auto gap-4'>
          <p className='text-accent text-xs font-bold'>FOR BORROWERS</p>
          <p className='text-h2'>Your Loan, Your Terms</p>
          <p className='text-foreground text-sm'>
            Choose your loan duration and interest rate. Match with a lender through transparent
            price discovery.
          </p>
        </div>
        <ul className='flex flex-col gap-6'>
          {POINTS.map(({ title, description }, index) => (
            <Reveal
              key={title}
              delay={0.1 + index * 0.06}
              y={12}
              className='flex items-start gap-2'
            >
              <CheckIcon className='text-success mt-0.5 size-6 shrink-0' />
              <p className='text-foreground text-sm'>
                <span className='font-bold'>{title}</span> {description}
              </p>
            </Reveal>
          ))}
        </ul>
      </Reveal>
      <Reveal
        x={24}
        y={0}
        delay={0.15}
        className='hidden lg:absolute lg:top-15 lg:right-20 lg:block'
      >
        <div className='lg:origin-top-right lg:scale-[0.6927]'>
          <LiveCreateOfferPreview />
        </div>
      </Reveal>
    </LandingContainer>
  )
}
