import CreateBorrowerAccountDemo from './CreateBorrowerAccountDemo'
import ScriptAuthCovenantDemo from './ScriptAuthCovenantDemo'
import { WalletDemo } from './WalletDemo'

export default function DashboardPage() {
  return (
    <div className='space-y-4 p-6'>
      <h1 className='text-3xl font-semibold'>Dashboard</h1>
      <WalletDemo />
      <CreateBorrowerAccountDemo />
      <ScriptAuthCovenantDemo />
    </div>
  )
}
