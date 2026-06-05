import CreateBorrowerAccountDemo from './CreateBorrowerAccountDemo'
import ScriptAuthCovenantDemo from './ScriptAuthCovenantDemo'
import { WalletDemo } from './WalletDemo'

export default function DemoPage() {
  return (
    <div className='space-y-4 p-6'>
      <h1 className='text-3xl font-semibold'>Demo</h1>
      <WalletDemo />
      <CreateBorrowerAccountDemo />
      <ScriptAuthCovenantDemo />
    </div>
  )
}
