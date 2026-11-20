import { useMutation } from '@tanstack/react-query'
import { useMemo } from 'react'

import { fetchFeeRateSatPerKvb } from '@/api/esplora/fee'
import { useOffer } from '@/api/indexer/hooks'
import { fetchOffer } from '@/api/indexer/methods'
import type { OfferShort } from '@/api/indexer/schemas'
import { findFinalizedLenderVault, resolveLenderNftOutpoint, toOutpoint } from '@/api/indexer/utils'
import DetailsPanel from '@/components/DetailsPanel'
import ArrowUpFromBracketIcon from '@/components/icons/ArrowUpFromBracketIcon'
import AmountHeroCard from '@/components/modals/AmountHeroCard'
import OfferActionShell from '@/components/modals/OfferActionShell'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { VAULT_CHANGED_MESSAGE } from '@/constants/offers'
import { useFormatAmount } from '@/hooks/useFormatAmount'
import { useLenderVaultClaim } from '@/hooks/useLenderVaultClaim'
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
import { formatAmount } from '@/utils/format'

const WITHDRAW_ALL_WEIGHT_UNITS =
  ASSET_AUTH_VAULT_MAX_WEIGHT_TO_SATISFY.WithdrawAll + EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY

interface WithdrawAllModalProps {
  isOpen: boolean
  offer: OfferShort
  onClose: () => void
  onSuccess: () => void
}

export default function WithdrawAllModal({
  isOpen,
  offer,
  onClose,
  onSuccess,
}: WithdrawAllModalProps) {
  const { syncWallet, getBlindedWalletUtxos, scriptPubkey } = useWallet()
  const { lwkNetwork } = useLwk()
  const { claimLenderVault } = useLenderVaultClaim()
  const runStandardTransactionFlow = useStandardTransactionFlow()
  const { addPendingTx } = usePendingTransactions()
  const { formatPrincipalAmount } = useFormatAmount()
  const { data: offerDetails } = useOffer(offer.id)
  const { principalAsset } = NETWORK_CONFIG
  const vaultBalance = offerDetails ? (findFinalizedLenderVault(offerDetails)?.amount ?? 0n) : 0n

  const withdrawAll = (expectedAmount: bigint) =>
    runStandardTransactionFlow(async () => {
      const fullOffer = await fetchOffer(offer.id)
      const vault = findFinalizedLenderVault(fullOffer)
      if (vault?.amount !== expectedAmount) throw new Error(VAULT_CHANGED_MESSAGE)

      const lenderNftOutpoint = resolveLenderNftOutpoint(fullOffer)
      if (!lenderNftOutpoint) throw new Error('Lender NFT UTXO not found')

      await syncWallet()
      const [blindedWalletUtxos, feeRate] = await Promise.all([
        getBlindedWalletUtxos(),
        fetchFeeRateSatPerKvb(),
      ])
      const feeBudgetSats = estimateFeeBudgetSats(WITHDRAW_ALL_WEIGHT_UNITS, feeRate)
      const feeUtxos = selectFeeUtxos(
        blindedWalletUtxos,
        lwkNetwork.policyAsset(),
        feeBudgetSats,
        feeRate,
      )

      return claimLenderVault({
        lenderVaultOutpoint: toOutpoint(vault),
        lenderNftOutpoint,
        createOfferTxid: offer.created_at_txid,
        feeOutpoints: feeUtxos.map(utxoToOutpointString),
      })
    })

  const { mutate, reset, data, status, variables } = useMutation({
    mutationFn: withdrawAll,
    onSuccess: (result, amount) => {
      void addPendingTx({
        txid: result.txid,
        kind: 'claim_interest',
        walletScriptPubkey: scriptPubkey ?? '',
        offerId: offer.id,
        previousOfferStatus: 'repaid',
        expectedOfferStatus: 'claimed',
        amount,
      })
    },
  })

  const txSummary = useMemo(
    () =>
      variables === undefined
        ? []
        : [{ label: 'Withdrawn', value: formatPrincipalAmount(variables) }],
    [variables, formatPrincipalAmount],
  )

  return (
    <OfferActionShell
      isOpen={isOpen}
      title='Full Withdrawal'
      icon={{ Icon: ArrowUpFromBracketIcon, tone: 'success' }}
      action={{
        label: 'Confirm Withdrawal',
        variant: 'primary',
        eyebrow: 'Withdraw',
        summary: txSummary,
        status,
        disabled: vaultBalance === 0n,
        txid: data?.txid,
        onConfirm: () => mutate(vaultBalance),
      }}
      onClose={() => {
        reset()
        onClose()
      }}
      onSuccess={onSuccess}
    >
      <div className='text-foreground flex flex-col gap-8'>
        <AmountHeroCard
          label='Withdraw'
          icon={principalAsset.icon}
          value={offerDetails ? formatAmount(vaultBalance, principalAsset.decimals) : '—'}
          unit={principalAsset.symbol}
        />
        <DetailsPanel
          title='Withdraw Details'
          rows={[
            {
              label: "Lender's Vault",
              value: offerDetails ? (
                <>
                  <span className='text-muted line-through'>
                    {formatAmount(vaultBalance, principalAsset.decimals)}
                  </span>
                  <span className='text-muted'>→</span>
                  {formatPrincipalAmount(0n)}
                </>
              ) : (
                '—'
              ),
            },
          ]}
        />
      </div>
    </OfferActionShell>
  )
}
