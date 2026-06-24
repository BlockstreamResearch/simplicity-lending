import { useMemo } from 'react'

import { useBlockHeight } from '@/api/esplora/hooks'
import type { OfferShort } from '@/api/indexer/schemas'
import BalanceCard from '@/components/BalanceCard'
import DetailsPanel, { type DetailRow } from '@/components/DetailsPanel'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useFormatAmount } from '@/hooks/useFormatAmount'
import { useWallet } from '@/providers/wallet/useWallet'
import { truncateAddress } from '@/utils/format'
import { calcInterest, computeApr, formatOfferTermLeft } from '@/utils/offers'

interface OfferDetailsBodyProps {
  offer: OfferShort
  highlightTerm?: boolean
}

export default function OfferDetailsBody({ offer, highlightTerm }: OfferDetailsBodyProps) {
  const { principalAsset } = NETWORK_CONFIG
  const { balances } = useWallet()
  const { formatCollateralDisplay, formatPrincipalAmount } = useFormatAmount()
  const { data: currentBlockHeight } = useBlockHeight()

  const loanInfoRows = useMemo<DetailRow[]>(() => {
    const interest = calcInterest(offer.principal_amount, offer.interest_rate)
    const loanDurationBlocks = offer.loan_expiration_height - offer.created_at_height
    const borrower = offer.participants.find(p => p.participant_type === 'borrower')

    const rows: DetailRow[] = [
      { label: 'Collateral Amount', value: formatCollateralDisplay(offer.collateral_amount) },
      { label: 'Loan Amount', value: formatPrincipalAmount(offer.principal_amount) },
      { label: 'Expected Earning', value: formatPrincipalAmount(interest) },
      { label: 'APR', value: `${computeApr(offer.interest_rate, loanDurationBlocks).toFixed(2)}%` },
    ]

    if (borrower) {
      rows.push({ label: 'Borrower ID', value: truncateAddress(borrower.script_pubkey) })
    }

    return rows
  }, [offer, formatCollateralDisplay, formatPrincipalAmount])

  const termRows = useMemo<DetailRow[]>(
    () => [
      { label: 'Duration (Expires at)', value: formatOfferTermLeft(offer, currentBlockHeight) },
      { label: 'Current Block', value: String(currentBlockHeight) },
      { label: 'Repayment Due Block', value: String(offer.loan_expiration_height) },
      {
        label: 'Blocks to Liquidation',
        value: `${Math.max(0, offer.loan_expiration_height - currentBlockHeight)} Blocks`,
      },
    ],
    [offer, currentBlockHeight],
  )

  return (
    <div className='flex flex-col gap-6'>
      <BalanceCard asset={principalAsset} amount={BigInt(balances[principalAsset.id] ?? 0)} />
      <DetailsPanel title='Loan info' rows={loanInfoRows} />
      <DetailsPanel title='Term' rows={termRows} bordered={highlightTerm} />
    </div>
  )
}
