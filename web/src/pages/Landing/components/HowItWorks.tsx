import { buttonVariants } from '@heroui/react'
import { Link } from 'react-router-dom'

import ChecksIcon from '@/components/icons/ChecksIcon'
import ListChecksIcon from '@/components/icons/ListChecksIcon'
import LockIcon from '@/components/icons/LockIcon'
import { RoutePath } from '@/constants/routes'

import { LandingContainer } from './LandingContainer'
import { Reveal } from './Reveal'

const STEPS = [
  {
    icon: ListChecksIcon,
    title: 'Set Your Terms',
    description: 'As the borrower, post your loan request. Choose your amount, rate, and duration',
  },
  {
    icon: LockIcon,
    title: 'Lock Collateral',
    description:
      'Lock your LBTC into a Simplicity smart contract. All loans are 100% secured and overcollateralized.',
  },
  {
    icon: ChecksIcon,
    title: 'Lender Accepts',
    description:
      "A lender reviews your offer and extends the loan. You receive USDT. If the loan isn't repaid, the lender takes possession of the collateral.",
  },
]

export function HowItWorks() {
  return (
    <section className='bg-surface-secondary'>
      <LandingContainer className='flex flex-col gap-10 py-12 lg:py-20'>
        <Reveal className='flex flex-col gap-2'>
          <p className='text-accent text-xs font-bold'>HOW IT WORKS</p>
          <p className='text-h2'>Get a Loan in Three Steps</p>
        </Reveal>
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3'>
          {STEPS.map(({ icon: Icon, title, description }, index) => (
            <Reveal
              key={title}
              delay={index * 0.08}
              className='bg-surface flex flex-col gap-3 rounded-3xl p-6'
            >
              <Icon className='text-foreground size-6' />
              <div className='flex flex-col gap-1.5'>
                <p className='text-foreground text-xl font-semibold'>{title}</p>
                <p className='text-muted text-sm'>{description}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal delay={0.2}>
          <Link to={RoutePath.Borrow} className={buttonVariants({ variant: 'primary' })}>
            Start a Loan
          </Link>
        </Reveal>
      </LandingContainer>
    </section>
  )
}
