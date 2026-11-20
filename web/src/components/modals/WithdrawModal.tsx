import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { z as zod } from 'zod'

import { FALLBACK_FEE_RATE_SAT_PER_KVB, fetchFeeRateSatPerKvb } from '@/api/esplora/fee'
import { isTxOutputSpent } from '@/api/esplora/methods'
import { esploraQueryKeys } from '@/api/esplora/queryKeys'
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
import { UiFieldLabel } from '@/components/ui/UiFieldLabel'
import { UiTextField } from '@/components/ui/UiTextField'
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
import { formatAmount, formatAmountInput } from '@/utils/format'
import { principalAmountSchema } from '@/utils/principalAmountSchema'

const WITHDRAW_WEIGHT_UNITS =
  ASSET_AUTH_VAULT_MAX_WEIGHT_TO_SATISFY.WithdrawPart + EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY

function createWithdrawSchema(withdrawable: bigint) {
  const { decimals, symbol } = NETWORK_CONFIG.principalAsset
  const formatPrincipal = (amount: bigint) => `${formatAmount(amount, decimals)} ${symbol}`

  return zod.object({
    amount: principalAmountSchema.pipe(
      zod
        .bigint()
        .positive('Enter a positive amount')
        .max(
          withdrawable,
          `You can withdraw up to ${formatPrincipal(withdrawable)} now. ${formatPrincipal(VAULT_MIN_REMAINDER)} stays in the vault until the loan is closed.`,
        ),
    ),
  })
}

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
  const { syncWallet, getBlindedWalletUtxos, scriptPubkey, confirmedBalances } = useWallet()
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

  const { data: feeRate = FALLBACK_FEE_RATE_SAT_PER_KVB } = useQuery({
    queryKey: esploraQueryKeys.feeRate,
    queryFn: () => fetchFeeRateSatPerKvb(),
  })
  const policyAssetId = lwkNetwork.policyAsset().toString()
  const hasFeeBalance =
    BigInt(confirmedBalances[policyAssetId] ?? 0) >=
    estimateFeeBudgetSats(WITHDRAW_WEIGHT_UNITS, feeRate)

  const resolver = useMemo(() => zodResolver(createWithdrawSchema(withdrawable)), [withdrawable])
  const {
    control,
    handleSubmit,
    trigger,
    getValues,
    reset: resetForm,
    formState: { isValid },
  } = useForm({
    resolver,
    mode: 'all',
    defaultValues: { amount: '' },
  })

  useEffect(() => {
    if (getValues('amount')) void trigger('amount')
  }, [resolver, getValues, trigger])

  const parsedAmount = principalAmountSchema.safeParse(useWatch({ control, name: 'amount' }))
  const enteredAmount = parsedAmount.success ? parsedAmount.data : 0n
  const leftInVault =
    enteredAmount > 0n && enteredAmount <= withdrawable ? vaultBalance - enteredAmount : null
  const actionLabel = isValid ? `Withdraw ${formatPrincipalAmount(enteredAmount)}` : 'Withdraw'

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
      title='Withdraw'
      icon={{ Icon: ArrowUpFromBracketIcon, tone: 'success' }}
      action={{
        label: actionLabel,
        variant: 'primary',
        eyebrow: 'Withdraw',
        summary: txSummary,
        status,
        disabled: !isValid || !hasFeeBalance,
        txid: data?.txid,
        onConfirm: () => void handleSubmit(({ amount }) => mutate({ amount, vaultBalance }))(),
      }}
      onClose={() => {
        reset()
        resetForm()
        onClose()
      }}
      onSuccess={onSuccess}
    >
      <div className='text-foreground flex flex-col gap-8'>
        <AmountHeroCard
          label='Available to Withdraw'
          icon={principalAsset.icon}
          value={offerDetails ? formatAmount(withdrawable, principalAsset.decimals) : '—'}
          unit={principalAsset.symbol}
        />
        <section className='bg-surface-secondary flex flex-col gap-6 rounded-xl p-6'>
          <h4 className='text-muted text-xs'>Withdraw Details</h4>
          <Controller
            control={control}
            name='amount'
            render={({ field, fieldState }) => (
              <UiTextField
                label={<UiFieldLabel required>Withdrawal Amount</UiFieldLabel>}
                placeholder='0.00'
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                endContent={principalAsset.symbol}
                onMax={() =>
                  field.onChange(formatAmountInput(withdrawable, principalAsset.decimals))
                }
                isMaxDisabled={withdrawable === 0n || enteredAmount === withdrawable}
                errorMessage={fieldState.error?.message}
              />
            )}
          />
        </section>
        <DetailsPanel
          title='After This Withdrawal'
          rows={[
            {
              label: 'Left in Vault',
              value: leftInVault === null ? '—' : formatPrincipalAmount(leftInVault),
            },
          ]}
        />
        {!hasFeeBalance && (
          <div className='border-warning/30 bg-warning/10 text-warning rounded-2xl border px-4 py-3 text-sm'>
            Not enough {NETWORK_CONFIG.collateralAsset.symbol} to pay the network fee.
          </div>
        )}
      </div>
    </OfferActionShell>
  )
}
