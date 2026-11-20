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
  getWithdrawableAmount,
  resolveLenderNftOutpoint,
  toOutpoint,
} from '@/api/indexer/utils'
import DetailsPanel from '@/components/DetailsPanel'
import ArrowUpFromBracketIcon from '@/components/icons/ArrowUpFromBracketIcon'
import AmountHeroCard from '@/components/modals/AmountHeroCard'
import OfferActionShell from '@/components/modals/OfferActionShell'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { VAULT_CHANGED_MESSAGE, VAULT_MIN_REMAINDER } from '@/constants/offers'
import { useFormatAmount } from '@/hooks/useFormatAmount'
import { useLenderVaultWithdrawPart } from '@/hooks/useLenderVaultWithdrawPart'
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

const WITHDRAW_WEIGHT_UNITS =
  ASSET_AUTH_VAULT_MAX_WEIGHT_TO_SATISFY.WithdrawPart + EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY

interface WithdrawSubmission {
  amount: bigint
  vaultBalance: bigint
}

interface WithdrawModalProps {
  isOpen: boolean
  offer: OfferShort
  onClose: () => void
  onSuccess: () => void
}

export default function WithdrawModal({ isOpen, offer, onClose, onSuccess }: WithdrawModalProps) {
  const { principalAsset } = NETWORK_CONFIG
  const { syncWallet, getBlindedWalletUtxos, scriptPubkey } = useWallet()
  const { lwkNetwork } = useLwk()
  const { withdrawLenderVaultPart } = useLenderVaultWithdrawPart()
  const runStandardTransactionFlow = useStandardTransactionFlow()
  const { addPendingTx } = usePendingTransactions()
  const { formatPrincipalAmount } = useFormatAmount()
  const { data: offerDetails } = useOffer(offer.id)

  const vaultBalance = offerDetails ? getActiveLenderVaultBalance(offerDetails) : 0n
  const withdrawable = offerDetails ? getWithdrawableAmount(offerDetails) : 0n

  const withdrawFromVault = ({ amount, vaultBalance: expectedVaultBalance }: WithdrawSubmission) =>
    runStandardTransactionFlow(async () => {
      const fullOffer = await fetchOffer(offer.id)
      const vault = findActiveLenderVault(fullOffer)
      if (vault?.amount !== expectedVaultBalance) throw new Error(VAULT_CHANGED_MESSAGE)

      if (await isTxOutputSpent(vault.txid, vault.vout)) throw new Error(VAULT_CHANGED_MESSAGE)

      const lenderNftOutpoint = resolveLenderNftOutpoint(fullOffer)
      if (!lenderNftOutpoint) throw new Error('Lender NFT UTXO not found')

      await syncWallet()
      const [blindedWalletUtxos, feeRate] = await Promise.all([
        getBlindedWalletUtxos(),
        fetchFeeRateSatPerKvb(),
      ])
      const feeBudgetSats = estimateFeeBudgetSats(WITHDRAW_WEIGHT_UNITS, feeRate)
      const feeUtxos = selectFeeUtxos(
        blindedWalletUtxos,
        lwkNetwork.policyAsset(),
        feeBudgetSats,
        feeRate,
      )

      return withdrawLenderVaultPart({
        lenderVaultOutpoint: toOutpoint(vault),
        lenderNftOutpoint,
        createOfferTxid: fullOffer.created_at_txid,
        alreadySupplied: vault.already_supplied.toString(),
        amountToWithdraw: amount.toString(),
        feeOutpoints: feeUtxos.map(utxoToOutpointString),
      })
    })

  const { mutate, reset, data, status, variables } = useMutation({
    mutationFn: withdrawFromVault,
    onSuccess: (result, submission) => {
      void addPendingTx({
        txid: result.txid,
        kind: 'withdraw_part',
        walletScriptPubkey: scriptPubkey ?? '',
        offerId: offer.id,
        previousOfferStatus: 'active',
        amount: submission.amount,
      })
    },
  })

  const txSummary = useMemo(
    () =>
      variables
        ? [
            { label: 'Withdrawn', value: formatPrincipalAmount(variables.amount) },
            {
              label: 'Left in Vault',
              value: formatPrincipalAmount(variables.vaultBalance - variables.amount),
            },
          ]
        : [],
    [variables, formatPrincipalAmount],
  )

  return (
    <OfferActionShell
      isOpen={isOpen}
      title='Partial Withdrawal'
      icon={{ Icon: ArrowUpFromBracketIcon, tone: 'success' }}
      action={{
        label: 'Confirm Withdrawal',
        variant: 'primary',
        eyebrow: 'Withdraw',
        summary: txSummary,
        status,
        disabled: withdrawable === 0n,
        txid: data?.txid,
        onConfirm: () => mutate({ amount: withdrawable, vaultBalance }),
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
          value={offerDetails ? formatAmount(withdrawable, principalAsset.decimals) : '—'}
          unit={principalAsset.symbol}
        />
        <DetailsPanel
          title='Withdraw Details'
          rows={[
            {
              label: "Lender's Vault",
              tooltip: `${formatPrincipalAmount(VAULT_MIN_REMAINDER)} stays in the vault so the borrower can keep repaying. You get it back when the loan closes.`,
              value: offerDetails ? (
                <>
                  <span className='text-muted line-through'>
                    {formatAmount(vaultBalance, principalAsset.decimals)}
                  </span>
                  <span className='text-muted'>→</span>
                  {formatPrincipalAmount(vaultBalance - withdrawable)}
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
