import { useMutation } from '@tanstack/react-query'
import { useMemo } from 'react'

import { fetchFeeRateSatPerKvb } from '@/api/esplora/fee'
import { isTxOutputSpent } from '@/api/esplora/methods'
import { useOffer } from '@/api/indexer/hooks'
import { fetchOffer } from '@/api/indexer/methods'
import type { OfferShort } from '@/api/indexer/schemas'
import {
  findActiveLenderVault,
  getActiveLenderVaultBalance,
  resolveActiveOutpoint,
  resolveLenderNftOutpoint,
  toOutpoint,
} from '@/api/indexer/utils'
import DetailsPanel from '@/components/DetailsPanel'
import TriangleExclamationIcon from '@/components/icons/TriangleExclamationIcon'
import AmountHeroCard from '@/components/modals/AmountHeroCard'
import OfferActionShell from '@/components/modals/OfferActionShell'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { VAULT_CHANGED_MESSAGE } from '@/constants/offers'
import { useBlockDate } from '@/hooks/useBlockDate'
import { useFormatAmount } from '@/hooks/useFormatAmount'
import { useLiquidateOffer } from '@/hooks/useLiquidateOffer'
import { useStandardTransactionFlow } from '@/hooks/useStandardTransactionFlow'
import {
  estimateFeeBudgetSats,
  EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY,
  selectFeeUtxos,
  utxoToOutpointString,
} from '@/lwk/utxo'
import { useLwk } from '@/providers/lwk/useLwk'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useWallet } from '@/providers/wallet/useWallet'
import { ASSET_AUTH_VAULT_MAX_WEIGHT_TO_SATISFY } from '@/simplicity/asset-auth-vault/program'
import { LENDING_MAX_WEIGHT_TO_SATISFY } from '@/simplicity/lending/program'
import { formatDateTime } from '@/utils/format'

const LIQUIDATE_WEIGHT_UNITS =
  LENDING_MAX_WEIGHT_TO_SATISFY.Liquidation +
  ASSET_AUTH_VAULT_MAX_WEIGHT_TO_SATISFY.WithdrawOnLiquidation +
  EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY

interface LiquidateSubmission {
  collateral: bigint
  fromVault: bigint
}

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
  const { syncWallet, getBlindedWalletUtxos, scriptPubkey } = useWallet()
  const { lwkNetwork } = useLwk()
  const { liquidateOffer } = useLiquidateOffer()
  const runStandardTransactionFlow = useStandardTransactionFlow()
  const { addPendingTx } = usePendingTransactions()
  const { formatCollateralDisplay, formatCollateralAmount, collateralUnit, formatPrincipalAmount } =
    useFormatAmount()
  const { data: offerDetails } = useOffer(offer.id)
  const deadlineDate = useBlockDate(offer.loan_expiration_height, offer.created_at_height)

  const liveOffer = offerDetails ?? offer
  const vaultBalance = offerDetails ? getActiveLenderVaultBalance(offerDetails) : 0n

  const liquidateExpiredOffer = ({ fromVault }: LiquidateSubmission) =>
    runStandardTransactionFlow(async () => {
      const fullOffer = await fetchOffer(offer.id)
      const activeOfferOutpoint = resolveActiveOutpoint(fullOffer)
      if (!activeOfferOutpoint) throw new Error('Active offer UTXO not found')

      const lenderNftOutpoint = resolveLenderNftOutpoint(fullOffer)
      if (!lenderNftOutpoint) throw new Error('Lender NFT UTXO not found')

      const lenderVault = findActiveLenderVault(fullOffer)
      if ((lenderVault?.amount ?? 0n) !== fromVault) throw new Error(VAULT_CHANGED_MESSAGE)
      if (lenderVault && (await isTxOutputSpent(lenderVault.txid, lenderVault.vout))) {
        throw new Error(VAULT_CHANGED_MESSAGE)
      }

      await syncWallet()
      const [blindedWalletUtxos, feeRate] = await Promise.all([
        getBlindedWalletUtxos(),
        fetchFeeRateSatPerKvb(),
      ])
      const feeBudgetSats = estimateFeeBudgetSats(LIQUIDATE_WEIGHT_UNITS, feeRate)
      const feeUtxos = selectFeeUtxos(
        blindedWalletUtxos,
        lwkNetwork.policyAsset(),
        feeBudgetSats,
        feeRate,
      )

      return liquidateOffer({
        activeOfferOutpoint,
        createOfferTxid: offer.created_at_txid,
        lenderNftOutpoint,
        currentDebt: fullOffer.current_debt.toString(),
        lenderVault: lenderVault
          ? {
              outpoint: toOutpoint(lenderVault),
              alreadySupplied: lenderVault.already_supplied.toString(),
            }
          : undefined,
        feeOutpoints: feeUtxos.map(utxoToOutpointString),
      })
    })

  const { mutate, reset, data, status, variables } = useMutation({
    mutationFn: liquidateExpiredOffer,
    onSuccess: result => {
      void addPendingTx({
        txid: result.txid,
        kind: 'liquidate_offer',
        walletScriptPubkey: scriptPubkey ?? '',
        offerId: offer.id,
        previousOfferStatus: 'active',
        expectedOfferStatus: 'liquidated',
      })
    },
  })

  const txSummary = useMemo(
    () =>
      variables
        ? [
            { label: 'Collateral', value: formatCollateralDisplay(variables.collateral) },
            ...(variables.fromVault > 0n
              ? [{ label: 'From Your Vault', value: formatPrincipalAmount(variables.fromVault) }]
              : []),
          ]
        : [],
    [variables, formatCollateralDisplay, formatPrincipalAmount],
  )

  return (
    <OfferActionShell
      isOpen={isOpen}
      title='Liquidate'
      icon={{ Icon: TriangleExclamationIcon, tone: 'danger' }}
      action={{
        label: `Liquidate ${formatCollateralDisplay(liveOffer.collateral_remaining)}`,
        variant: 'danger',
        eyebrow: 'Liquidate',
        summary: txSummary,
        status,
        disabled: !offerDetails,
        txid: data?.txid,
        onConfirm: () =>
          mutate({ collateral: liveOffer.collateral_remaining, fromVault: vaultBalance }),
      }}
      onClose={() => {
        reset()
        onClose()
      }}
      onSuccess={onSuccess}
    >
      <div className='text-foreground flex flex-col gap-8'>
        <AmountHeroCard
          label='Collateral to Liquidate'
          icon={NETWORK_CONFIG.collateralAsset.icon}
          value={formatCollateralAmount(liveOffer.collateral_remaining)}
          unit={collateralUnit}
        />
        <DetailsPanel
          title='Offer Details'
          rows={[
            {
              label: 'Unpaid Debt',
              value: (
                <span className='text-danger'>{formatPrincipalAmount(liveOffer.current_debt)}</span>
              ),
            },
            {
              label: 'Repayment Deadline',
              value: deadlineDate ? formatDateTime(deadlineDate) : '–',
            },
          ]}
        />
        {vaultBalance > 0n && (
          <DetailsPanel
            title='You Also Receive'
            rows={[
              {
                label: 'From Your Vault',
                value: (
                  <span className='text-success'>+ {formatPrincipalAmount(vaultBalance)}</span>
                ),
              },
            ]}
          />
        )}
        <div className='border-warning/30 bg-warning/10 text-warning rounded-2xl border px-4 py-3 text-sm'>
          This ends the loan. The borrower won&apos;t be able to repay anymore.
        </div>
      </div>
    </OfferActionShell>
  )
}
