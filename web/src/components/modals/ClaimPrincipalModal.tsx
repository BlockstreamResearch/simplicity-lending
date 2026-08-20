import { Chip } from '@heroui/react'
import { useMutation } from '@tanstack/react-query'
import { useMemo } from 'react'

import type { OfferShort } from '@/api/indexer/schemas'
import OfferActionShell from '@/components/modals/OfferActionShell'
import OfferDetailsBody from '@/components/modals/OfferDetailsBody'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useClaimPrincipalAction } from '@/hooks/useClaimPrincipalAction'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useWallet } from '@/providers/walletFacade/useWallet'
import { formatAmount } from '@/utils/format'

interface ClaimPrincipalModalProps {
  isOpen: boolean
  offer: OfferShort
  onClose: () => void
  onSuccess: () => void
}

export default function ClaimPrincipalModal({
  isOpen,
  offer,
  onClose,
  onSuccess,
}: ClaimPrincipalModalProps) {
  const { principalAsset } = NETWORK_CONFIG
  const { scriptPubkey } = useWallet()
  const claimPrincipal = useClaimPrincipalAction()
  const { addPendingTx } = usePendingTransactions()

  const { mutate, reset, data, status } = useMutation({
    mutationFn: () => claimPrincipal(offer.id),
    onSuccess: ({ txid }) => {
      void addPendingTx({
        txid,
        kind: 'claim_principal',
        walletScriptPubkey: scriptPubkey ?? '',
        offerId: offer.id,
        previousOfferStatus: offer.status,
        expectedOfferStatus: offer.status,
      })
    },
  })

  const txSummary = useMemo(
    () => [
      {
        label: 'Principal',
        value: `${formatAmount(offer.principal_amount, principalAsset.decimals)} ${principalAsset.symbol}`,
      },
    ],
    [offer, principalAsset],
  )

  return (
    <OfferActionShell
      isOpen={isOpen}
      title='Claim Principal Offer'
      chip={
        <Chip color='accent' variant='soft' size='sm'>
          Claim
        </Chip>
      }
      action={{
        label: 'Claim Principal',
        variant: 'primary',
        eyebrow: 'Claim Principal',
        summary: txSummary,
        status,
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
    </OfferActionShell>
  )
}
