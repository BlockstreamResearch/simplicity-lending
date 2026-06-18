import { useMutation } from '@tanstack/react-query'

import { useBlockHeight } from '@/api/esplora/hooks'
import { useOffer } from '@/api/indexer/hooks'
import type { OfferShort } from '@/api/indexer/schemas'
import OfferModal from '@/components/modals/OfferModal'
import { OfferStatusChip } from '@/components/OfferStatusChip'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useAcceptOffer } from '@/hooks/useAcceptOffer'
import { selectFeeUtxo, utxoToOutpointString } from '@/lwk/utxo'
import { useLwk } from '@/providers/lwk/useLwk'
import { useWallet } from '@/providers/wallet/useWallet'
import { formatAmount, truncateAddress } from '@/utils/format'
import { resolveCreateOfferNftOutpoints, resolvePendingOutpoint } from '@/utils/offerOutpoints'
import { bpsToPercent, calcInterest, getOfferDisplayStatus } from '@/utils/offers'
import { selectOptimalUtxo } from '@/utils/utxo'

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
  const blockHeightQuery = useBlockHeight()
  const currentBlockHeight = blockHeightQuery.data ?? 0

  const fullOfferQuery = useOffer(offer.id)
  const fullOffer = fullOfferQuery.data ?? null

  const acceptBorrowOffer = async () => {
    if (!fullOffer) throw new Error('Offer details not loaded')
    const pendingOfferOutpoint = resolvePendingOutpoint(fullOffer)
    if (!pendingOfferOutpoint) throw new Error('Pending offer UTXO not found')

    await syncWallet()
    const walletUtxos = await getBlindedWalletUtxos()

    const principalUtxo = selectOptimalUtxo(
      walletUtxos
        .filter(u => u.unblinded().asset().toString() === principalAsset.id)
        .map(u => ({ outpoint: utxoToOutpointString(u), value: u.unblinded().value() })),
      offer.principal_amount,
    )
    if (!principalUtxo) throw new Error(`Insufficient ${principalAsset.symbol} balance`)

    const feeUtxo = selectFeeUtxo(walletUtxos, lwkNetwork.policyAsset())
    const nftOutpoints = resolveCreateOfferNftOutpoints(fullOffer)
    if (!nftOutpoints) throw new Error('Offer NFT participants not found')
    const { lenderNft, borrowerNftReference } = nftOutpoints

    return acceptOffer({
      pendingOfferOutpoint,
      lenderNftOutpoint: lenderNft,
      borrowerNftReferenceOutpoint: borrowerNftReference,
      principalOutpoint: principalUtxo.outpoint,
      feeOutpoint: utxoToOutpointString(feeUtxo),
    })
  }

  const { mutate, reset, data, error, status } = useMutation({ mutationFn: acceptBorrowOffer })

  const borrower = fullOffer?.participants.find(p => p.participant_type === 'borrower')
  const title = `${truncateAddress(borrower?.script_pubkey ?? offer.created_at_txid)} Supply Offers`

  const txSummary = [
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
  ]

  return (
    <OfferModal
      isOpen={isOpen}
      offer={offer}
      fullOffer={fullOffer}
      title={title}
      chip={<OfferStatusChip status={getOfferDisplayStatus(offer, currentBlockHeight)} />}
      principalLabel='Loan Amount'
      action={{
        label: 'Accept & Supply',
        eyebrow: 'Accept Offer',
        summary: txSummary,
        status,
        disabled: !fullOffer,
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
