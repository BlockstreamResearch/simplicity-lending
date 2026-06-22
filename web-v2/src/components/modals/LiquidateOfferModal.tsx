import { Chip } from '@heroui/react'
import { useMutation } from '@tanstack/react-query'
import { useMemo } from 'react'

import { fetchOffer } from '@/api/indexer/methods'
import type { OfferShort } from '@/api/indexer/schemas'
import OfferActionShell from '@/components/modals/OfferActionShell'
import OfferDetailsBody from '@/components/modals/OfferDetailsBody'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useLiquidateOffer } from '@/hooks/useLiquidateOffer'
import { selectFeeUtxo, utxoToOutpointString } from '@/lwk/utxo'
import { useLwk } from '@/providers/lwk/useLwk'
import { useWallet } from '@/providers/wallet/useWallet'
import { formatAmount, truncateAddress } from '@/utils/format'
import { resolveActiveOutpoint, resolveLenderNftOutpoint } from '@/utils/offerOutpoints'

interface LiquidateOfferModalProps {
  isOpen: boolean
  offer: OfferShort
  onClose: () => void
  onSuccess: () => void
}

export default function LiquidateOfferModal({
  isOpen,
  offer,
  onClose,
  onSuccess,
}: LiquidateOfferModalProps) {
  const { collateralAsset } = NETWORK_CONFIG
  const { syncWallet, getBlindedWalletUtxos } = useWallet()
  const { lwkNetwork } = useLwk()
  const { liquidateOffer } = useLiquidateOffer()

  const liquidateExpiredOffer = async () => {
    const fullOffer = await fetchOffer(offer.id)
    const activeOfferOutpoint = resolveActiveOutpoint(fullOffer)
    if (!activeOfferOutpoint) throw new Error('Active offer UTXO not found')

    const lenderNftOutpoint = resolveLenderNftOutpoint(fullOffer)
    if (!lenderNftOutpoint) throw new Error('Lender NFT UTXO not found')

    await syncWallet()
    const blindedWalletUtxos = await getBlindedWalletUtxos()
    const feeUtxo = selectFeeUtxo(blindedWalletUtxos, lwkNetwork.policyAsset())

    return liquidateOffer({
      activeOfferOutpoint,
      createOfferTxid: offer.created_at_txid,
      lenderNftOutpoint,
      feeOutpoint: utxoToOutpointString(feeUtxo),
    })
  }

  const { mutate, reset, data, error, status } = useMutation({ mutationFn: liquidateExpiredOffer })

  const txSummary = useMemo(
    () => [
      {
        label: 'Collateral',
        value: `${formatAmount(offer.collateral_amount, collateralAsset.decimals)} ${collateralAsset.symbol}`,
      },
      { label: 'Expiration Block', value: `#${offer.loan_expiration_height}` },
    ],
    [offer, collateralAsset],
  )

  return (
    <OfferActionShell
      isOpen={isOpen}
      title={`#${truncateAddress(offer.id)} - Liquidation`}
      chip={
        <Chip color='danger' variant='soft' size='sm'>
          Liquidate
        </Chip>
      }
      action={{
        label: 'Liquidate & Claim Collateral',
        variant: 'danger-soft',
        eyebrow: 'Liquidate Offer',
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
      <OfferDetailsBody offer={offer} highlightTerm principalLabel='Loan Amount' />
    </OfferActionShell>
  )
}
