import { useMemo } from 'react'

import { useBlockHeight } from '@/api/esplora/hooks'
import type { OfferShort } from '@/api/indexer/schemas'
import BalanceCard from '@/components/BalanceCard'
import DetailsPanel, { type DetailRow } from '@/components/DetailsPanel'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useAssetDenomination } from '@/providers/assetDenomination/useAssetDenomination'
import { useWallet } from '@/providers/wallet/useWallet'
import { formatAmount, truncateAddress } from '@/utils/format'
import { calcInterest, computeApr, formatOfferTermLeft } from '@/utils/offers'
import { formatPolicyAssetDisplay } from '@/utils/policyAssetDenomination'

interface OfferDetailsBodyProps {
  offer: OfferShort
  highlightTerm?: boolean
}

export default function OfferDetailsBody({ offer, highlightTerm }: OfferDetailsBodyProps) {
  const { collateralAsset, principalAsset } = NETWORK_CONFIG
  const { balances } = useWallet()
  const { denomination } = useAssetDenomination()
  const { data: currentBlockHeight } = useBlockHeight()

  const loanInfoRows = useMemo<DetailRow[]>(() => {
    const interest = calcInterest(offer.principal_amount, offer.interest_rate)
    const loanDurationBlocks = offer.loan_expiration_height - offer.created_at_height
    const borrower = offer.participants.find(p => p.participant_type === 'borrower')
    const lender = offer.participants.find(p => p.participant_type === 'lender')

    const rows: DetailRow[] = [
      {
        label: 'Collateral Amount',
        value: formatPolicyAssetDisplay(offer.collateral_amount, denomination, collateralAsset),
      },
      {
        label: 'Loan Amount',
        value: `${formatAmount(offer.principal_amount, principalAsset.decimals)} ${principalAsset.symbol}`,
      },
      {
        label: 'Expected Earning',
        value: `${formatAmount(interest, principalAsset.decimals)} ${principalAsset.symbol}`,
      },
      { label: 'APR', value: `${computeApr(offer.interest_rate, loanDurationBlocks).toFixed(2)}%` },
    ]

    if (borrower) {
      rows.push({ label: 'Borrower Address', value: truncateAddress(borrower.script_pubkey) })
    }
    if (lender) {
      rows.push({ label: 'Lender Address', value: truncateAddress(lender.script_pubkey) })
    }

    return rows
  }, [offer, collateralAsset, principalAsset, denomination])

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
