import { Chip } from '@heroui/react'
import { useMutation } from '@tanstack/react-query'
import { useMemo } from 'react'

import { fetchOffer } from '@/api/indexer/methods'
import type { OfferShort } from '@/api/indexer/schemas'
import OfferActionShell from '@/components/modals/OfferActionShell'
import OfferDetailsBody from '@/components/modals/OfferDetailsBody'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useLenderVaultClaim } from '@/hooks/useLenderVaultClaim'
import { selectFeeUtxos, utxoToOutpointString } from '@/lwk/utxo'
import { useLwk } from '@/providers/lwk/useLwk'
import { useWallet } from '@/providers/wallet/useWallet'
import { formatAmount, truncateAddress } from '@/utils/format'
import { resolveLenderNftOutpoint, resolveRepaymentOutpoint } from '@/utils/offerOutpoints'
import { calcInterest } from '@/utils/offers'

interface ClaimModalProps {
  isOpen: boolean
  offer: OfferShort
  onClose: () => void
  onSuccess: () => void
}

export default function ClaimModal({ isOpen, offer, onClose, onSuccess }: ClaimModalProps) {
  const { principalAsset } = NETWORK_CONFIG
  const { syncWallet, getBlindedWalletUtxos } = useWallet()
  const { lwkNetwork } = useLwk()
  const { claimLenderVault } = useLenderVaultClaim()

  const claimVault = async () => {
    const fullOffer = await fetchOffer(offer.id)
    const vaultOutpoint = resolveRepaymentOutpoint(fullOffer)
    if (!vaultOutpoint) throw new Error('Lender vault UTXO not found')

    const lenderNftOutpoint = resolveLenderNftOutpoint(fullOffer)
    if (!lenderNftOutpoint) throw new Error('Lender NFT UTXO not found')

    await syncWallet()
    const blindedWalletUtxos = await getBlindedWalletUtxos()
    const feeUtxos = selectFeeUtxos(blindedWalletUtxos, lwkNetwork.policyAsset())

    return claimLenderVault({
      lenderVaultOutpoint: vaultOutpoint,
      lenderNftOutpoint,
      feeOutpoints: feeUtxos.map(utxoToOutpointString),
    })
  }

  const { mutate, reset, data, error, status } = useMutation({ mutationFn: claimVault })

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
      title={`#${truncateAddress(offer.id)} - Claim`}
      chip={
        <Chip color='accent' variant='soft' size='sm'>
          Claim
        </Chip>
      }
      action={{
        label: 'Claim',
        eyebrow: 'Claim Vault',
        summary: txSummary,
        status,
        txid: data?.txid,
        error: error?.message,
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
