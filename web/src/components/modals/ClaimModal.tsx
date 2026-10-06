import { Chip } from '@heroui/react'
import { useMutation } from '@tanstack/react-query'
import { useMemo } from 'react'

import type { OfferShort } from '@/api/indexer/schemas'
import OfferActionShell from '@/components/modals/OfferActionShell'
import OfferDetailsBody from '@/components/modals/OfferDetailsBody'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useLenderVaultClaimAction } from '@/hooks/useLenderVaultClaimAction'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useWallet } from '@/providers/walletFacade/useWallet'
import { formatAmount } from '@/utils/format'
import { calcInterest } from '@/utils/offers'

interface ClaimModalProps {
  isOpen: boolean
  offer: OfferShort
  onClose: () => void
  onSuccess: () => void
}

export default function ClaimModal({ isOpen, offer, onClose, onSuccess }: ClaimModalProps) {
  const { principalAsset } = NETWORK_CONFIG
  const { scriptPubkey } = useWallet()
  const claimLenderVault = useLenderVaultClaimAction()
  const { addPendingTx } = usePendingTransactions()

  const { mutate, reset, data, status } = useMutation({
    mutationFn: () => claimLenderVault(offer.id),
    onSuccess: ({ txid }) => {
      void addPendingTx({
        txid,
        kind: 'claim_interest',
        walletScriptPubkey: scriptPubkey ?? '',
        offerId: offer.id,
        previousOfferStatus: 'repaid',
        expectedOfferStatus: 'claimed',
      })
    },
  })

  const txSummary = useMemo(() => {
    const interestAmount = calcInterest(offer.principal_amount, offer.interest_rate)

    return [
      {
        label: 'Principal',
        value: `${formatAmount(offer.principal_amount, principalAsset.decimals)} ${principalAsset.symbol}`,
      },
      {
        label: 'Interest',
        value: `${formatAmount(interestAmount, principalAsset.decimals)} ${principalAsset.symbol}`,
      },
      {
        label: 'Total',
        value: `${formatAmount(offer.principal_amount + interestAmount, principalAsset.decimals)} ${principalAsset.symbol}`,
      },
    ]
  }, [offer, principalAsset])

  return (
    <OfferActionShell
      isOpen={isOpen}
      title='Claim Offer'
      chip={
        <Chip color='accent' variant='soft' size='sm'>
          Claim
        </Chip>
      }
      action={{
        label: 'Claim',
        variant: 'primary',
        eyebrow: 'Claim Vault',
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
