import { useMutation } from '@tanstack/react-query'
import { useMemo } from 'react'

import { fetchFeeRateSatPerKvb } from '@/api/esplora/fee'
import { fetchOffer } from '@/api/indexer/methods'
import type { OfferShort } from '@/api/indexer/schemas'
import OfferActionShell from '@/components/modals/OfferActionShell'
import OfferDetailsBody from '@/components/modals/OfferDetailsBody'
import { OfferStatusChip } from '@/components/OfferStatusChip'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useAcceptOffer } from '@/hooks/useAcceptOffer'
import {
  estimateFeeBudgetSats,
  selectAssetUtxos,
  selectFeeUtxos,
  utxoToOutpointString,
} from '@/lwk/utxo'
import { useLwk } from '@/providers/lwk/useLwk'
import { useWallet } from '@/providers/wallet/useWallet'
import { LENDING_MAX_WEIGHT_TO_SATISFY } from '@/simplicity/lending/program'
import { SCRIPT_AUTH_MAX_WEIGHT_TO_SATISFY } from '@/simplicity/script-auth/program'
import { formatAmount, truncateAddress } from '@/utils/format'
import { resolveCreateOfferNftOutpoints, resolvePendingOutpoint } from '@/utils/offerOutpoints'
import { bpsToPercent, calcInterest } from '@/utils/offers'

const ACCEPT_WEIGHT_UNITS =
  LENDING_MAX_WEIGHT_TO_SATISFY.OfferAcceptance + SCRIPT_AUTH_MAX_WEIGHT_TO_SATISFY

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
  const { collateralAsset, principalAsset } = NETWORK_CONFIG
  const { syncWallet, getBlindedWalletUtxos } = useWallet()
  const { lwkNetwork } = useLwk()
  const { acceptOffer } = useAcceptOffer()

  const acceptBorrowOffer = async () => {
    const fullOffer = await fetchOffer(offer.id)
    const pendingOfferOutpoint = resolvePendingOutpoint(fullOffer)
    if (!pendingOfferOutpoint) throw new Error('Pending offer UTXO not found')

    await syncWallet()
    const [blindedWalletUtxos, feeRate] = await Promise.all([
      getBlindedWalletUtxos(),
      fetchFeeRateSatPerKvb(),
    ])

    const principalUtxos = selectAssetUtxos(
      blindedWalletUtxos,
      principalAsset.id,
      offer.principal_amount,
      principalAsset.symbol,
    )

    const feeBudgetSats = estimateFeeBudgetSats(ACCEPT_WEIGHT_UNITS, feeRate)
    const feeUtxos = selectFeeUtxos(blindedWalletUtxos, lwkNetwork.policyAsset(), feeBudgetSats)
    const nftOutpoints = resolveCreateOfferNftOutpoints(fullOffer)
    if (!nftOutpoints) throw new Error('Offer NFT participants not found')
    const { lenderNft, borrowerNft } = nftOutpoints

    return acceptOffer({
      pendingOfferOutpoint,
      lenderNftOutpoint: lenderNft,
      borrowerNftReferenceOutpoint: borrowerNft,
      principalOutpoints: principalUtxos.map(utxoToOutpointString),
      feeOutpoints: feeUtxos.map(utxoToOutpointString),
    })
  }

  const { mutate, reset, data, error, status } = useMutation({ mutationFn: acceptBorrowOffer })

  const borrower = offer.participants.find(p => p.participant_type === 'borrower')
  const title = `${truncateAddress(borrower?.script_pubkey || '')} Supply Offers`

  const txSummary = useMemo(
    () => [
      {
        label: 'Collateral',
        value: `${formatAmount(offer.collateral_amount, collateralAsset.decimals)} ${collateralAsset.symbol}`,
      },
      {
        label: 'Principal Supplied',
        value: `${formatAmount(offer.principal_amount, principalAsset.decimals)} ${principalAsset.symbol}`,
      },
      {
        label: 'Earn',
        value: `${formatAmount(calcInterest(offer.principal_amount, offer.interest_rate), principalAsset.decimals)} ${principalAsset.symbol}`,
      },
      { label: 'APR', value: bpsToPercent(offer.interest_rate) },
    ],
    [offer, collateralAsset, principalAsset],
  )

  return (
    <OfferActionShell
      isOpen={isOpen}
      title={title}
      chip={<OfferStatusChip status={offer.status} />}
      action={{
        label: 'Accept & Supply',
        eyebrow: 'Accept Offer',
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
