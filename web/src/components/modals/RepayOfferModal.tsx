import { Chip } from '@heroui/react'
import { useMutation } from '@tanstack/react-query'
import { useMemo } from 'react'

import type { OfferShort } from '@/api/indexer/schemas'
import OfferActionShell from '@/components/modals/OfferActionShell'
import OfferDetailsBody from '@/components/modals/OfferDetailsBody'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useFormatAmount } from '@/hooks/useFormatAmount'
import { useRepayOfferAction } from '@/hooks/useRepayOfferAction'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useWallet } from '@/providers/walletFacade/useWallet'
import { calcInterest } from '@/utils/offers'

interface RepayOfferModalProps {
  isOpen: boolean
  offer: OfferShort
  onClose: () => void
  onSuccess: () => void
}

export default function RepayOfferModal({
  isOpen,
  offer,
  onClose,
  onSuccess,
}: RepayOfferModalProps) {
  const { principalAsset } = NETWORK_CONFIG
  const { scriptPubkey, confirmedBalances } = useWallet()
  const repayOffer = useRepayOfferAction()
  const { addPendingTx } = usePendingTransactions()
  const { formatCollateralDisplay, formatPrincipalAmount } = useFormatAmount()

  const { mutate, reset, data, status } = useMutation({
    mutationFn: () => repayOffer(offer.id),
    onSuccess: ({ txid }) => {
      void addPendingTx({
        txid,
        kind: 'repay_offer',
        walletScriptPubkey: scriptPubkey ?? '',
        offerId: offer.id,
        previousOfferStatus: 'active',
        expectedOfferStatus: 'repaid',
      })
    },
  })

  const totalToRepay =
    offer.principal_amount + calcInterest(offer.principal_amount, offer.interest_rate)
  // The whole debt has to be there before the wallet is asked; how it is funded and what the
  // fee costs are the wallet's, so this checks the debt alone rather than guessing at both.
  const insufficientBalance = BigInt(confirmedBalances[principalAsset.id] ?? 0) < totalToRepay

  const txSummary = useMemo(() => {
    const interest = calcInterest(offer.principal_amount, offer.interest_rate)

    return [
      { label: 'Principal', value: formatPrincipalAmount(offer.principal_amount) },
      { label: 'Interest', value: formatPrincipalAmount(interest) },
      {
        label: 'Total Repayment',
        value: formatPrincipalAmount(offer.principal_amount + interest),
      },
      { label: 'Collateral Returned', value: formatCollateralDisplay(offer.collateral_amount) },
    ]
  }, [offer, formatPrincipalAmount, formatCollateralDisplay])

  return (
    <OfferActionShell
      isOpen={isOpen}
      title='Repay Offer'
      chip={
        <Chip color='accent' variant='soft' size='sm'>
          Repay
        </Chip>
      }
      action={{
        label: 'Repay Loan',
        variant: 'primary',
        eyebrow: 'Repay Loan',
        summary: txSummary,
        status,
        disabled: insufficientBalance,
        txid: data?.txid,
        onConfirm: () => mutate(),
      }}
      onClose={() => {
        reset()
        onClose()
      }}
      onSuccess={onSuccess}
    >
      <OfferDetailsBody offer={offer} />
      {insufficientBalance && (
        <div className='rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning'>
          Insufficient {principalAsset.symbol} balance to repay this loan.
        </div>
      )}
    </OfferActionShell>
  )
}
