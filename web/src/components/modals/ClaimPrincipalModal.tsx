import { Chip } from '@heroui/react'
import { useMutation } from '@tanstack/react-query'
import { useMemo } from 'react'

import { fetchFeeRateSatPerKvb } from '@/api/esplora/fee'
import { fetchOffer } from '@/api/indexer/methods'
import type { OfferShort } from '@/api/indexer/schemas'
import { resolveNftOutpoints, toOutpoint } from '@/api/indexer/utils'
import OfferActionShell from '@/components/modals/OfferActionShell'
import OfferDetailsBody from '@/components/modals/OfferDetailsBody'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useClaimPrincipal } from '@/hooks/useClaimPrincipal'
import {
  estimateFeeBudgetSats,
  EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY,
  selectFeeUtxos,
  utxoToOutpointString,
} from '@/lwk/utxo'
import { useLwk } from '@/providers/lwk/useLwk'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useWallet } from '@/providers/wallet/useWallet'
import { ASSET_AUTH_MAX_WEIGHT_TO_SATISFY } from '@/simplicity/asset-auth/program'
import { formatAmount } from '@/utils/format'

const CLAIM_PRINCIPAL_WEIGHT_UNITS =
  ASSET_AUTH_MAX_WEIGHT_TO_SATISFY + EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY

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
  const { syncWallet, getBlindedWalletUtxos, scriptPubkey } = useWallet()
  const { lwkNetwork } = useLwk()
  const { claimPrincipal } = useClaimPrincipal()
  const { addPendingTx } = usePendingTransactions()

  const claimBorrowerPrincipal = async () => {
    if (!offer.borrower_principal_utxo) throw new Error('Borrower principal UTXO not found')
    const principalOutpoint = toOutpoint(offer.borrower_principal_utxo)

    const fullOffer = await fetchOffer(offer.id)
    const nftOutpoints = resolveNftOutpoints(fullOffer)
    if (!nftOutpoints) throw new Error('Offer NFT participants not found')

    await syncWallet()
    const [blindedWalletUtxos, feeRate] = await Promise.all([
      getBlindedWalletUtxos(),
      fetchFeeRateSatPerKvb(),
    ])

    const feeBudgetSats = estimateFeeBudgetSats(CLAIM_PRINCIPAL_WEIGHT_UNITS, feeRate)
    const feeUtxos = selectFeeUtxos(
      blindedWalletUtxos,
      lwkNetwork.policyAsset(),
      feeBudgetSats,
      feeRate,
    )

    return claimPrincipal({
      principalOutpoint,
      borrowerNftOutpoint: nftOutpoints.borrowerNft,
      feeOutpoints: feeUtxos.map(utxoToOutpointString),
    })
  }

  const { mutate, reset, data, error, status } = useMutation({
    mutationFn: claimBorrowerPrincipal,
    onSuccess: result => {
      void addPendingTx({
        txid: result.txid,
        kind: 'claim_principal',
        walletScriptPubkey: scriptPubkey ?? '',
        offerId: offer.id,
        previousOfferStatus: 'active',
        expectedOfferStatus: 'active',
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
        <Chip color='success' variant='soft' size='sm'>
          Claim
        </Chip>
      }
      action={{
        label: 'Claim Principal',
        eyebrow: 'Claim Principal',
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
