import { Chip } from '@heroui/react'
import { useMutation } from '@tanstack/react-query'

import { useOffer } from '@/api/indexer/hooks'
import type { OfferShort } from '@/api/indexer/schemas'
import OfferModal from '@/components/modals/OfferModal'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useLenderVaultClaim } from '@/hooks/useLenderVaultClaim'
import { selectFeeUtxo, utxoToOutpointString } from '@/lwk/utxo'
import { useLwk } from '@/providers/lwk/useLwk'
import { useWallet } from '@/providers/wallet/useWallet'
import { formatAmount, truncateAddress } from '@/utils/format'
import { resolveLenderNftOutpoint, resolveVaultOutpoint } from '@/utils/offerOutpoints'
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

  const fullOfferQuery = useOffer(offer.id)
  const fullOffer = fullOfferQuery.data ?? null
  const vaultOutpoint = fullOffer ? resolveVaultOutpoint(fullOffer) : null

  const claimVault = async () => {
    if (!fullOffer) throw new Error('Offer details not loaded')
    if (!vaultOutpoint) throw new Error('Lender vault UTXO not found')

    const lenderNftOutpoint = resolveLenderNftOutpoint(fullOffer)
    if (!lenderNftOutpoint) throw new Error('Lender NFT UTXO not found')

    await syncWallet()
    const walletUtxos = await getBlindedWalletUtxos()
    const feeUtxo = selectFeeUtxo(walletUtxos, lwkNetwork.policyAsset())

    return claimLenderVault({
      lenderVaultOutpoint: vaultOutpoint,
      lenderNftOutpoint,
      feeOutpoint: utxoToOutpointString(feeUtxo),
    })
  }

  const { mutate, reset, data, error, status } = useMutation({ mutationFn: claimVault })

  const interestAmount = calcInterest(offer.principal_amount, offer.interest_rate)
  const txSummary = [
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

  return (
    <OfferModal
      isOpen={isOpen}
      offer={offer}
      fullOffer={fullOffer}
      title={`#${truncateAddress(offer.id)} - Claim`}
      chip={
        <Chip color='accent' variant='soft' size='sm'>
          Claim
        </Chip>
      }
      principalLabel='Loan Amount'
      action={{
        label: 'Claim',
        eyebrow: 'Claim Vault',
        summary: txSummary,
        status,
        disabled: !vaultOutpoint,
        txid: data?.txid,
        error: error?.message,
        onConfirm: () => mutate(),
      }}
      onClose={() => {
        reset()
        onClose()
      }}
      onSuccess={onSuccess}
    />
  )
}
