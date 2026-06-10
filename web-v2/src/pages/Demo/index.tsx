import AcceptOfferDemo from './AcceptOfferDemo'
import CancelOfferDemo from './CancelOfferDemo'
import CreateBorrowerAccountDemo from './CreateBorrowerAccountDemo'
import CreateOfferDemo from './CreateOfferDemo'
import { WalletDemo } from './WalletDemo'

export default function DemoPage() {
  return (
    <div className='space-y-4 p-6'>
      <h1 className='text-3xl font-semibold'>Demo</h1>
      <WalletDemo />
      <CreateBorrowerAccountDemo />
      <CreateOfferDemo />
      <AcceptOfferDemo />
      <CancelOfferDemo />
    </div>
  )
}
