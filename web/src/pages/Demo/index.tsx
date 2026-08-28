import AcceptOfferDemo from './AcceptOfferDemo'
import CancelOfferDemo from './CancelOfferDemo'
import ClaimPrincipalDemo from './ClaimPrincipalDemo'
import CreateBorrowerAccountDemo from './CreateBorrowerAccountDemo'
import CreateOfferDemo from './CreateOfferDemo'
import LenderVaultClaimDemo from './LenderVaultClaimDemo'
import LenderVaultWithdrawPartDemo from './LenderVaultWithdrawPartDemo'
import LiquidateOfferDemo from './LiquidateOfferDemo'
import PartialRepayOfferDemo from './PartialRepayOfferDemo'
import ProtocolFeeVaultClaimDemo from './ProtocolFeeVaultClaimDemo'
import ProtocolFeeVaultWithdrawPartDemo from './ProtocolFeeVaultWithdrawPartDemo'
import RepayOfferDemo from './RepayOfferDemo'
import UtxoChopperDemo from './UtxoChopperDemo'
import { WalletDemo } from './WalletDemo'

export default function DemoPage() {
  return (
    <div className='space-y-4 p-6'>
      <h1 className='text-3xl font-semibold'>Demo</h1>
      <WalletDemo />
      <UtxoChopperDemo />
      <CreateBorrowerAccountDemo />
      <CreateOfferDemo />
      <AcceptOfferDemo />
      <ClaimPrincipalDemo />
      <CancelOfferDemo />
      <LiquidateOfferDemo />
      <RepayOfferDemo />
      <PartialRepayOfferDemo />
      <LenderVaultClaimDemo />
      <LenderVaultWithdrawPartDemo />
      <ProtocolFeeVaultClaimDemo />
      <ProtocolFeeVaultWithdrawPartDemo />
    </div>
  )
}
