import { useMutation } from '@tanstack/react-query'
import { useMemo } from 'react'

import type { OfferShort } from '@/api/indexer/schemas'
import OfferActionShell from '@/components/modals/OfferActionShell'
import OfferDetailsBody from '@/components/modals/OfferDetailsBody'
import { OfferStatusChip } from '@/components/OfferStatusChip'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useAcceptOfferAction } from '@/hooks/useAcceptOfferAction'
import { useFormatAmount } from '@/hooks/useFormatAmount'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useWallet } from '@/providers/walletFacade/useWallet'
import { calcInterest, computeApr } from '@/utils/offers'

interface AcceptOfferModalProps {
  isOpen: boolean
  offer: OfferShort
  onClose: () => void
  onSuccess: () => void
}

export default function AcceptOfferModal({
  isOpen,
  offer,
  onClose,
  onSuccess,
}: AcceptOfferModalProps) {
  const { principalAsset } = NETWORK_CONFIG
  const { scriptPubkey, confirmedBalances } = useWallet()
  const acceptOffer = useAcceptOfferAction()
  const { addPendingTx } = usePendingTransactions()
  const { formatCollateralDisplay, formatPrincipalAmount } = useFormatAmount()

  const { mutate, reset, data, status } = useMutation({
    mutationFn: () => acceptOffer(offer.id),
    onSuccess: ({ txid }) => {
      void addPendingTx({
        txid,
        kind: 'accept_offer',
        walletScriptPubkey: scriptPubkey ?? '',
        offerId: offer.id,
        previousOfferStatus: 'pending',
        expectedOfferStatus: 'active',
      })
    },
  })

  // What the wallet will actually fund the principal from is its own to choose, and it holds
  // the fee too. What a person needs answered here is whether this account has the principal
  // at all, because the answer to that is "top up" rather than "the wallet found nothing".
  const insufficientBalance =
    BigInt(confirmedBalances[principalAsset.id] ?? 0) < offer.principal_amount

  const txSummary = useMemo(
    () => [
      { label: 'Collateral', value: formatCollateralDisplay(offer.collateral_amount) },
      { label: 'Principal Supplied', value: formatPrincipalAmount(offer.principal_amount) },
      {
        label: 'Earn',
        value: formatPrincipalAmount(calcInterest(offer.principal_amount, offer.interest_rate)),
      },
      {
        label: 'APR',
        value: `${computeApr(offer.interest_rate, offer.loan_expiration_height - offer.created_at_height).toFixed(2)}%`,
      },
    ],
    [offer, formatCollateralDisplay, formatPrincipalAmount],
  )

  return (
    <OfferActionShell
      isOpen={isOpen}
      title='Accept Offer'
      chip={<OfferStatusChip status={offer.status} />}
      action={{
        label: 'Accept & Supply',
        eyebrow: 'Accept Offer',
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
          Insufficient {principalAsset.symbol} balance to accept this offer.
        </div>
      )}
    </OfferActionShell>
  )
}
