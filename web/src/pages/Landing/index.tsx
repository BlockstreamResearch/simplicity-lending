import { ComparisonTable } from './components/ComparisonTable'
import { ForBorrowers } from './components/ForBorrowers'
import { ForLenders } from './components/ForLenders'
import { GetStarted } from './components/GetStarted'
import { Hero } from './components/Hero'
import { HowItWorks } from './components/HowItWorks'
import { LandingFooter } from './components/LandingFooter'
import { LandingHeader } from './components/LandingHeader'
import { RateIndex } from './components/RateIndex'
import { WhySimplicity } from './components/WhySimplicity'

export default function LandingPage() {
  return (
    <main className='bg-surface text-foreground min-h-screen'>
      <LandingHeader />
      <Hero />
      <GetStarted />
      <WhySimplicity />
      <HowItWorks />
      <ForBorrowers />
      <ForLenders />
      <RateIndex />
      <ComparisonTable />
      <LandingFooter />
    </main>
  )
}
