import { useMemo } from 'react'

import { useBlockHeight } from '@/api/esplora/hooks'
import type { OfferShort } from '@/api/indexer/schemas'
import { useAssetPriceUsd } from '@/api/prices/hooks'
import BalanceCard from '@/components/BalanceCard'
import DetailsPanel, { type DetailRow } from '@/components/DetailsPanel'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useFormatAmount } from '@/hooks/useFormatAmount'
import { useWallet } from '@/providers/wallet/useWallet'
import { truncateAddress } from '@/utils/format'
import { calcInterest, computeApr, computeLtv, formatOfferTermLeft } from '@/utils/offers'

interface OfferDetailsBodyProps {
  offer: OfferShort
  highlightTerm?: boolean
  showBalance?: boolean
}

export default function OfferDetailsBody({
  offer,
  highlightTerm,
  showBalance = true,
}: OfferDetailsBodyProps) {
  const { principalAsset, collateralAsset } = NETWORK_CONFIG
  const { balances, isReady } = useWallet()
  const { formatCollateralDisplay, formatPrincipalAmount } = useFormatAmount()
  const { data: currentBlockHeight } = useBlockHeight()
  const collateralUsd = useAssetPriceUsd(collateralAsset.id)

  const loanInfoRows = useMemo<DetailRow[]>(() => {
    const interest = calcInterest(offer.principal_amount, offer.interest_rate)
    const loanDurationBlocks = offer.loan_expiration_height - offer.created_at_height
    const borrower = offer.participants.find(p => p.participant_type === 'borrower')
    const ltv = computeLtv({
      principal: offer.principal_amount,
      principalDecimals: principalAsset.decimals,
      collateral: offer.collateral_amount,
      collateralDecimals: collateralAsset.decimals,
      collateralUsd,
    })

    const rows: DetailRow[] = [
      {
        label: 'Offer ID',
        value: truncateAddress(offer.id),
        copyValue: offer.id,
        tooltip: 'The unique identifier of this offer in the system.',
      },
      {
        label: 'Collateral Amount',
        value: formatCollateralDisplay(offer.collateral_amount),
        tooltip: 'The LBTC you locked as collateral for this loan.',
      },
      {
        label: 'Loan Amount',
        value: formatPrincipalAmount(offer.principal_amount),
        tooltip: 'The USDT you borrowed and now repay.',
      },
      {
        label: 'Expected Earning',
        value: formatPrincipalAmount(interest),
        tooltip: 'The interest you earn when the borrower repays this loan.',
      },
      {
        label: 'APR',
        value: `${computeApr(offer.interest_rate, loanDurationBlocks).toFixed(2)}%`,
        tooltip: 'The annualized cost of this loan.',
      },
      {
        label: 'LTV & Risk Level',
        value: ltv === null ? '—' : `${(ltv * 100).toFixed(2)}%`,
        tooltip:
          "Your loan as a percentage of your collateral's value. Higher percentage means higher risk.",
      },
    ]

    if (borrower) {
      rows.push({
        label: 'Borrower ID',
        value: truncateAddress(borrower.script_pubkey),
        tooltip: 'The Liquid address of the borrower who took this loan.',
      })
    }

    return rows
  }, [
    offer,
    formatCollateralDisplay,
    formatPrincipalAmount,
    principalAsset,
    collateralAsset,
    collateralUsd,
  ])

  const termRows = useMemo<DetailRow[]>(
    () => [
      {
        label: 'Term Left',
        value: formatOfferTermLeft(offer, currentBlockHeight),
        tooltip: 'Time left to repay before the loan is due.',
      },
      {
        label: 'Current Block',
        value: String(currentBlockHeight),
        tooltip: 'The latest Liquid block.',
      },
      {
        label: 'Repayment Due',
        value: String(offer.loan_expiration_height),
        tooltip: 'When your repayment is due by.',
      },
      {
        label: 'Time to Liquidation',
        value: `${Math.max(0, offer.loan_expiration_height - currentBlockHeight)} Blocks`,
        tooltip: "Time left before the lender can claim your collateral if it's unpaid.",
      },
    ],
    [offer, currentBlockHeight],
  )

  return (
    <div className='flex flex-col gap-6'>
      {showBalance && isReady && (
        <BalanceCard asset={principalAsset} amount={BigInt(balances[principalAsset.id] ?? 0)} />
      )}
      <DetailsPanel title='Loan info' rows={loanInfoRows} />
      <DetailsPanel title='Term' rows={termRows} bordered={highlightTerm} />
    </div>
  )
}
