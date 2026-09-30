import AcceptOfferActionDemo from './AcceptOfferActionDemo'
import CancelOfferActionDemo from './CancelOfferActionDemo'
import ClaimPrincipalActionDemo from './ClaimPrincipalActionDemo'
import CreateBorrowerAccountDemo from './CreateBorrowerAccountDemo'
import CreateOfferActionDemo from './CreateOfferActionDemo'
import LenderVaultClaimActionDemo from './LenderVaultClaimActionDemo'
import LiquidateOfferActionDemo from './LiquidateOfferActionDemo'
import RepayOfferActionDemo from './RepayOfferActionDemo'
import UtxoChopperDemo from './UtxoChopperDemo'

export default function DemoPage() {
  return (
    <div className='space-y-4 p-6'>
      <h1 className='text-3xl font-semibold'>Demo</h1>
      <UtxoChopperDemo />
      <CreateBorrowerAccountDemo />
      <CreateOfferActionDemo />
      <AcceptOfferActionDemo />
      <ClaimPrincipalActionDemo />
      <CancelOfferActionDemo />
      <LiquidateOfferActionDemo />
      <RepayOfferActionDemo />
      <LenderVaultClaimActionDemo />
    </div>
  )
}
