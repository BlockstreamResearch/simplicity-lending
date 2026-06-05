import CreateBorrowerAccountDemo from './Demos/CreateBorrowerAccountDemo'
import ScriptAuthCovenantDemo from './Demos/ScriptAuthCovenantDemo'
import { WalletDemo } from './Demos/WalletDemo'

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
