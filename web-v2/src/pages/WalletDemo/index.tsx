import { WalletDemo } from './WalletDemo'

// DEV-only page for manually testing wallet connect / sign / broadcast flows.
export default function WalletDemoPage() {
  return (
    <div className='flex flex-col gap-6'>
      <h1 className='text-h2'>Wallet Demo</h1>
      <WalletDemo />
    </div>
  )
}
