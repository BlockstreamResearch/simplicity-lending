import { Chip } from '@heroui/react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { FALLBACK_FEE_RATE_SAT_PER_KVB, fetchFeeRateSatPerKvb } from '@/api/esplora/fee'
import { esploraQueryKeys } from '@/api/esplora/queryKeys'
import { fetchOffer } from '@/api/indexer/methods'
import type { OfferShort } from '@/api/indexer/schemas'
import { resolveActiveOutpoint, resolveBorrowerNftOutpoint } from '@/api/indexer/utils'
import OfferActionShell from '@/components/modals/OfferActionShell'
import OfferDetailsBody from '@/components/modals/OfferDetailsBody'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useFormatAmount } from '@/hooks/useFormatAmount'
import { useRepayOffer } from '@/hooks/useRepayOffer'
import {
  estimateFeeBudgetSats,
  EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY,
  selectAssetUtxos,
  selectFeeUtxos,
  utxoToOutpointString,
} from '@/lwk/utxo'
import { useLwk } from '@/providers/lwk/useLwk'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useWallet } from '@/providers/wallet/useWallet'
import { LENDING_MAX_WEIGHT_TO_SATISFY } from '@/simplicity/lending/program'
import { calcInterest } from '@/utils/offers'

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
  const { principalAsset } = NETWORK_CONFIG
  const { syncWallet, getBlindedWalletUtxos, scriptPubkey, balances } = useWallet()
  const { lwkNetwork } = useLwk()
  const { repayOffer } = useRepayOffer()
  const { addPendingTx } = usePendingTransactions()
  const { formatCollateralDisplay, formatPrincipalAmount } = useFormatAmount()

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

  const totalToRepay =
    offer.principal_amount + calcInterest(offer.principal_amount, offer.interest_rate)
  const { data: feeRate = FALLBACK_FEE_RATE_SAT_PER_KVB } = useQuery({
    queryKey: esploraQueryKeys.feeRate,
    queryFn: () => fetchFeeRateSatPerKvb(),
  })
  const feeBuffer =
    principalAsset.id === lwkNetwork.policyAsset().toString()
      ? estimateFeeBudgetSats(REPAY_WEIGHT_UNITS, feeRate)
      : 0n
  const insufficientBalance = BigInt(balances[principalAsset.id] ?? 0) < totalToRepay + feeBuffer

  const txSummary = useMemo(() => {
    const interest = calcInterest(offer.principal_amount, offer.interest_rate)
    return [
      { label: 'Principal', value: formatPrincipalAmount(offer.principal_amount) },
      { label: 'Interest', value: formatPrincipalAmount(interest) },
      {
        label: 'Total Repayment',
        value: formatPrincipalAmount(offer.principal_amount + interest),
      },
      { label: 'Collateral Returned', value: formatCollateralDisplay(offer.collateral_amount) },
    ]
  }, [offer, formatPrincipalAmount, formatCollateralDisplay])

  return (
    <OfferActionShell
      isOpen={isOpen}
      title='Repay Offer'
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
        disabled: insufficientBalance,
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
      {insufficientBalance && (
        <div className='rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning'>
          Insufficient {principalAsset.symbol} balance to repay this loan.
        </div>
      )}
    </OfferActionShell>
  )
}
