import { Chip } from '@heroui/react'
import { useMutation } from '@tanstack/react-query'
import { useMemo } from 'react'

import { fetchFeeRateSatPerKvb } from '@/api/esplora/fee'
import { fetchOffer } from '@/api/indexer/methods'
import type { OfferShort } from '@/api/indexer/schemas'
import { resolveNftOutpoints, resolvePendingOutpoint } from '@/api/indexer/utils'
import OfferActionShell from '@/components/modals/OfferActionShell'
import OfferDetailsBody from '@/components/modals/OfferDetailsBody'
import { useCancelOffer } from '@/hooks/useCancelOffer'
import { useDefaultTransactionFlow } from '@/hooks/useDefaultTransactionFlow'
import { useFormatAmount } from '@/hooks/useFormatAmount'
import {
  estimateFeeBudgetSats,
  EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY,
  selectFeeUtxos,
  utxoToOutpointString,
} from '@/lwk/utxo'
import { useLwk } from '@/providers/lwk/useLwk'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useWallet } from '@/providers/wallet/useWallet'
import { LENDING_MAX_WEIGHT_TO_SATISFY } from '@/simplicity/lending/program'
import { SCRIPT_AUTH_MAX_WEIGHT_TO_SATISFY } from '@/simplicity/script-auth/program'

const CANCEL_WEIGHT_UNITS =
  LENDING_MAX_WEIGHT_TO_SATISFY.OfferCancellation +
  SCRIPT_AUTH_MAX_WEIGHT_TO_SATISFY +
  EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY

interface CancelOfferModalProps {
  isOpen: boolean
  offer: OfferShort
  onClose: () => void
  onSuccess: () => void
}

export default function CancelOfferModal({
  isOpen,
  offer,
  onClose,
  onSuccess,
}: CancelOfferModalProps) {
  const { syncWallet, getBlindedWalletUtxos, getReceiveAddress, scriptPubkey } = useWallet()
  const { lwkNetwork } = useLwk()
  const { cancelOffer } = useCancelOffer()
  const runDefaultTransactionFlow = useDefaultTransactionFlow()
  const { addPendingTx } = usePendingTransactions()
  const { formatCollateralDisplay } = useFormatAmount()

  const cancelBorrowOffer = () =>
    runDefaultTransactionFlow(async () => {
      const fullOffer = await fetchOffer(offer.id)
      const pendingOfferOutpoint = resolvePendingOutpoint(fullOffer)
      if (!pendingOfferOutpoint) throw new Error('Pending offer UTXO not found')

      const nftOutpoints = resolveNftOutpoints(fullOffer)
      if (!nftOutpoints) throw new Error('Offer NFT participants not found')

      const collateralRecipientAddress = await getReceiveAddress()
      if (!collateralRecipientAddress) throw new Error('Missing wallet receive address')

      await syncWallet()
      const [blindedWalletUtxos, feeRate] = await Promise.all([
        getBlindedWalletUtxos(),
        fetchFeeRateSatPerKvb(),
      ])

      const feeBudgetSats = estimateFeeBudgetSats(CANCEL_WEIGHT_UNITS, feeRate)
      const feeUtxos = selectFeeUtxos(
        blindedWalletUtxos,
        lwkNetwork.policyAsset(),
        feeBudgetSats,
        feeRate,
      )

      return cancelOffer({
        pendingOfferOutpoint,
        lenderNftOutpoint: nftOutpoints.lenderNft,
        borrowerNftOutpoint: nftOutpoints.borrowerNft,
        collateralRecipientAddress,
        feeOutpoints: feeUtxos.map(utxoToOutpointString),
      })
    })

  const { mutate, reset, data, status } = useMutation({
    mutationFn: cancelBorrowOffer,
    onSuccess: result => {
      void addPendingTx({
        txid: result.txid,
        kind: 'cancel_offer',
        walletScriptPubkey: scriptPubkey ?? '',
        offerId: offer.id,
        previousOfferStatus: 'pending',
        expectedOfferStatus: 'cancelled',
      })
    },
  })

  const txSummary = useMemo(
    () => [
      { label: 'Collateral Returned', value: formatCollateralDisplay(offer.collateral_amount) },
    ],
    [offer, formatCollateralDisplay],
  )

  return (
    <OfferActionShell
      isOpen={isOpen}
      title='Cancel Offer'
      chip={
        <Chip color='danger' variant='soft' size='sm'>
          Cancel
        </Chip>
      }
      action={{
        label: 'Cancel Offer',
        variant: 'danger-soft',
        eyebrow: 'Cancel Offer',
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
