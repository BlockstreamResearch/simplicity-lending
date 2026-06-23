import { Chip } from '@heroui/react'
import { useMutation } from '@tanstack/react-query'
import { useMemo } from 'react'

import { fetchFeeRateSatPerKvb } from '@/api/esplora/fee'
import { fetchOffer } from '@/api/indexer/methods'
import type { OfferShort } from '@/api/indexer/schemas'
import { resolveActiveOutpoint, resolveBorrowerNftOutpoint } from '@/api/indexer/utils'
import OfferActionShell from '@/components/modals/OfferActionShell'
import OfferDetailsBody from '@/components/modals/OfferDetailsBody'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useRepayOffer } from '@/hooks/useRepayOffer'
import {
  estimateFeeBudgetSats,
  EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY,
  selectAssetUtxos,
  selectFeeUtxos,
  utxoToOutpointString,
} from '@/lwk/utxo'
import { useAssetDenomination } from '@/providers/assetDenomination/useAssetDenomination'
import { useLwk } from '@/providers/lwk/useLwk'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useWallet } from '@/providers/wallet/useWallet'
import { LENDING_MAX_WEIGHT_TO_SATISFY } from '@/simplicity/lending/program'
import { formatAmount, truncateAddress } from '@/utils/format'
import { calcInterest } from '@/utils/offers'
import { formatPolicyAssetDisplay } from '@/utils/policyAssetDenomination'

const REPAY_WEIGHT_UNITS =
  LENDING_MAX_WEIGHT_TO_SATISFY.FullRepayment + EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY

interface RepayOfferModalProps {
  isOpen: boolean
  offer: OfferShort
  onClose: () => void
  onSuccess: () => void
}

export default function RepayOfferModal({
  isOpen,
  offer,
  onClose,
  onSuccess,
}: RepayOfferModalProps) {
  const { collateralAsset, principalAsset } = NETWORK_CONFIG
  const { syncWallet, getBlindedWalletUtxos, scriptPubkey } = useWallet()
  const { lwkNetwork } = useLwk()
  const { repayOffer } = useRepayOffer()
  const { addPendingTx } = usePendingTransactions()
  const { denomination } = useAssetDenomination()

  const repayBorrowOffer = async () => {
    const fullOffer = await fetchOffer(offer.id)
    const activeOfferOutpoint = resolveActiveOutpoint(fullOffer)
    if (!activeOfferOutpoint) throw new Error('Active offer UTXO not found')

    const borrowerNftOutpoint = resolveBorrowerNftOutpoint(fullOffer)
    if (!borrowerNftOutpoint) throw new Error('Borrower NFT UTXO not found')

    const totalToRepay =
      offer.principal_amount + calcInterest(offer.principal_amount, offer.interest_rate)

    await syncWallet()
    const [blindedWalletUtxos, feeRate] = await Promise.all([
      getBlindedWalletUtxos(),
      fetchFeeRateSatPerKvb(),
    ])

    const principalUtxos = selectAssetUtxos(
      blindedWalletUtxos,
      principalAsset.id,
      totalToRepay,
      principalAsset.symbol,
    )

    const feeBudgetSats = estimateFeeBudgetSats(REPAY_WEIGHT_UNITS, feeRate)
    const feeUtxos = selectFeeUtxos(
      blindedWalletUtxos,
      lwkNetwork.policyAsset(),
      feeBudgetSats,
      feeRate,
    )

    return repayOffer({
      activeOfferOutpoint,
      borrowerNftOutpoint,
      principalOutpoints: principalUtxos.map(utxoToOutpointString),
      feeOutpoints: feeUtxos.map(utxoToOutpointString),
    })
  }

  const { mutate, reset, data, error, status } = useMutation({
    mutationFn: repayBorrowOffer,
    onSuccess: result => {
      void addPendingTx({
        txid: result.txid,
        kind: 'repay_offer',
        walletScriptPubkey: scriptPubkey ?? '',
        offerId: offer.id,
        previousOfferStatus: 'active',
        expectedOfferStatus: 'repaid',
      })
    },
  })

  const txSummary = useMemo(() => {
    const interest = calcInterest(offer.principal_amount, offer.interest_rate)
    return [
      {
        label: 'Principal',
        value: `${formatAmount(offer.principal_amount, principalAsset.decimals)} ${principalAsset.symbol}`,
      },
      {
        label: 'Interest',
        value: `${formatAmount(interest, principalAsset.decimals)} ${principalAsset.symbol}`,
      },
      {
        label: 'Total Repayment',
        value: `${formatAmount(offer.principal_amount + interest, principalAsset.decimals)} ${principalAsset.symbol}`,
      },
      {
        label: 'Collateral Returned',
        value: formatPolicyAssetDisplay(offer.collateral_amount, denomination, collateralAsset),
      },
    ]
  }, [offer, principalAsset, collateralAsset, denomination])

  return (
    <OfferActionShell
      isOpen={isOpen}
      title={`#${truncateAddress(offer.id)} - Repay`}
      chip={
        <Chip color='warning' variant='soft' size='sm'>
          Repay
        </Chip>
      }
      action={{
        label: 'Repay Loan',
        eyebrow: 'Repay Loan',
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
