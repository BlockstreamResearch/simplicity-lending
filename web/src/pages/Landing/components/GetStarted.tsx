import { buttonVariants } from '@heroui/react'

import { LandingContainer } from './LandingContainer'
import { Reveal } from './Reveal'

const NOTIFY_FORM_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLSeY0vxIRrWz7QU-5V2FHmLKdK-JwmV5ZJlUY0qNBBw-NEajUQ/viewform?usp=sharing&ouid=102090179835098963155'

export function GetStarted() {
  return (
    <section className='bg-surface-secondary'>
      <LandingContainer className='flex flex-col items-center gap-10 py-12 text-center lg:py-20'>
        <Reveal className='text-foreground flex flex-col gap-4'>
          <p className='text-[36px] leading-10 font-semibold'>Get Started</p>
          <p className='text-sm'>
            Simplicity Lending isn&apos;t live on mainnet yet. Leave your email and we&apos;ll let
            you know the moment it launches.
          </p>
        </Reveal>
        <Reveal delay={0.15}>
          <a
            className={buttonVariants({ variant: 'primary' })}
            href={NOTIFY_FORM_URL}
            target='_blank'
            rel='noopener noreferrer'
          >
            Be the first to know
          </a>
        </Reveal>
      </LandingContainer>
    </section>
  )
}
