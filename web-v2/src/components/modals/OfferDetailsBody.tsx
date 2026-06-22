import { useMemo } from 'react'

import { useBlockHeight } from '@/api/esplora/hooks'
import type { OfferShort } from '@/api/indexer/schemas'
import BalanceCard from '@/components/BalanceCard'
import DetailsPanel, { type DetailRow } from '@/components/DetailsPanel'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useWallet } from '@/providers/wallet/useWallet'
import { formatAmount, truncateAddress } from '@/utils/format'
import { calcInterest, computeApr, formatOfferTermLeft } from '@/utils/offers'

type Counterparty = 'borrower' | 'lender'

interface OfferDetailsBodyProps {
  offer: OfferShort
  counterparty?: Counterparty
  highlightTerm?: boolean
  principalLabel: string
}

export default function OfferDetailsBody({
  offer,
  counterparty = 'borrower',
  highlightTerm,
  principalLabel,
}: OfferDetailsBodyProps) {
  const { collateralAsset, principalAsset } = NETWORK_CONFIG
  const { balances } = useWallet()
  const { data: currentBlockHeight } = useBlockHeight()

  const loanInfoRows = useMemo<DetailRow[]>(() => {
    const interest = calcInterest(offer.principal_amount, offer.interest_rate)
    const loanDurationBlocks = offer.loan_expiration_height - offer.created_at_height
    const counterpartyParticipant = offer.participants.find(
      p => p.participant_type === counterparty,
    )
    const counterpartyLabel = counterparty === 'lender' ? 'Lender Address' : 'Borrower Address'

    return [
      {
        label: 'Collateral Amount',
        value: `${formatAmount(offer.collateral_amount, collateralAsset.decimals)} ${collateralAsset.symbol}`,
      },
      {
        label: principalLabel,
        value: `${formatAmount(offer.principal_amount, principalAsset.decimals)} ${principalAsset.symbol}`,
      },
      {
        label: 'Expected Earning',
        value: `${formatAmount(interest, principalAsset.decimals)} ${principalAsset.symbol}`,
      },
      { label: 'APR', value: `${computeApr(offer.interest_rate, loanDurationBlocks).toFixed(2)}%` },
      {
        label: counterpartyLabel,
        value: counterpartyParticipant
          ? truncateAddress(counterpartyParticipant.script_pubkey)
          : '–',
      },
    ]
  }, [offer, counterparty, collateralAsset, principalAsset, principalLabel])

  const termRows = useMemo<DetailRow[]>(
    () => [
      { label: 'Duration (Expires at)', value: formatOfferTermLeft(offer, currentBlockHeight) },
      { label: 'Current Block', value: String(currentBlockHeight) },
      { label: 'Repayment Due Block', value: `#${offer.loan_expiration_height}` },
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
