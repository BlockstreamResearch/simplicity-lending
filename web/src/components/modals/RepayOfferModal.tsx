import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery } from '@tanstack/react-query'
import { type ReactNode, useEffect, useMemo } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { z as zod } from 'zod'

import { FALLBACK_FEE_RATE_SAT_PER_KVB, fetchFeeRateSatPerKvb } from '@/api/esplora/fee'
import { esploraQueryKeys } from '@/api/esplora/queryKeys'
import { fetchOffer } from '@/api/indexer/methods'
import type { OfferShort } from '@/api/indexer/schemas'
import {
  resolveActiveLenderVaultOutpoint,
  resolveActiveOutpoint,
  resolveActiveProtocolFeeVaultOutpoint,
  resolveBorrowerNftOutpoint,
} from '@/api/indexer/utils'
import HandArrowDownIcon from '@/components/icons/HandArrowDownIcon'
import OfferActionShell from '@/components/modals/OfferActionShell'
import { UiFieldLabel } from '@/components/ui/UiFieldLabel'
import { UiTextField } from '@/components/ui/UiTextField'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useFormatAmount } from '@/hooks/useFormatAmount'
import { usePartialRepayOffer } from '@/hooks/usePartialRepayOffer'
import { useStandardTransactionFlow } from '@/hooks/useStandardTransactionFlow'
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
import { getAlreadyUnlockedCollateral } from '@/simplicity/lending/utils'
import { toBigintAmount } from '@/utils/bigint'
import { DECIMAL_AMOUNT_RE, formatAmount, formatAmountInput } from '@/utils/format'
import { calcInterest } from '@/utils/offers'
import { toUint16, toUint64 } from '@/utils/uint'

const REPAY_WEIGHT_UNITS =
  LENDING_MAX_WEIGHT_TO_SATISFY.FullRepayment + EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY

const PRINCIPAL_AMOUNT_RE = new RegExp(
  `^\\d+(\\.\\d{1,${NETWORK_CONFIG.principalAsset.decimals}})?$`,
)

const principalAmountSchema = zod
  .string()
  .trim()
  .min(1, 'Enter an amount')
  .regex(DECIMAL_AMOUNT_RE, 'Enter a valid amount')
  .regex(PRINCIPAL_AMOUNT_RE, `Use up to ${NETWORK_CONFIG.principalAsset.decimals} decimal places`)
  .transform(value => toBigintAmount(value, NETWORK_CONFIG.principalAsset.decimals))

function createRepaySchema(currentDebt: bigint, spendable: bigint) {
  const { decimals, symbol } = NETWORK_CONFIG.principalAsset
  const formatPrincipal = (amount: bigint) => `${formatAmount(amount, decimals)} ${symbol}`

  return zod.object({
    amount: principalAmountSchema.pipe(
      zod
        .bigint()
        .positive('Enter a positive amount')
        .max(currentDebt, `Amount exceeds the debt left to repay (${formatPrincipal(currentDebt)})`)
        .max(spendable, `Insufficient ${symbol} balance (${formatPrincipal(spendable)} available)`),
    ),
  })
}

function RepayPreviewRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className='border-separator flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t pt-3 text-sm font-medium'>
      <span>{label}</span>
      <span className='ml-auto'>{children}</span>
    </div>
  )
}

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
  const { icon: PrincipalIcon } = principalAsset
  const { syncWallet, getBlindedWalletUtxos, scriptPubkey, confirmedBalances } = useWallet()
  const { lwkNetwork } = useLwk()
  const { partialRepayOffer } = usePartialRepayOffer()
  const runStandardTransactionFlow = useStandardTransactionFlow()
  const { addPendingTx } = usePendingTransactions()
  const { formatCollateralDisplay, formatPrincipalAmount } = useFormatAmount()

  const repayBorrowOffer = (amountToRepay: bigint) =>
    runStandardTransactionFlow(async () => {
      const fullOffer = await fetchOffer(offer.id)
      const activeOfferOutpoint = resolveActiveOutpoint(fullOffer)
      if (!activeOfferOutpoint) throw new Error('Active offer UTXO not found')

      const borrowerNftOutpoint = resolveBorrowerNftOutpoint(fullOffer)
      if (!borrowerNftOutpoint) throw new Error('Borrower NFT UTXO not found')

      await syncWallet()
      const [blindedWalletUtxos, feeRate] = await Promise.all([
        getBlindedWalletUtxos(),
        fetchFeeRateSatPerKvb(),
      ])

      const principalUtxos = selectAssetUtxos(
        blindedWalletUtxos,
        principalAsset.id,
        amountToRepay,
        principalAsset.symbol,
      )

      const feeBudgetSats = estimateFeeBudgetSats(REPAY_WEIGHT_UNITS, feeRate)
      const feeUtxos = selectFeeUtxos(
        blindedWalletUtxos,
        lwkNetwork.policyAsset(),
        feeBudgetSats,
        feeRate,
      )

      return partialRepayOffer({
        activeOfferOutpoint,
        createOfferTxid: fullOffer.created_at_txid,
        borrowerNftOutpoint,
        amountToRepay: amountToRepay.toString(),
        currentDebt: fullOffer.current_debt.toString(),
        lenderVaultOutpoint: resolveActiveLenderVaultOutpoint(fullOffer) ?? undefined,
        protocolFeeVaultOutpoint: resolveActiveProtocolFeeVaultOutpoint(fullOffer) ?? undefined,
        principalOutpoints: principalUtxos.map(utxoToOutpointString),
        feeOutpoints: feeUtxos.map(utxoToOutpointString),
      })
    })

  const { mutate, reset, data, status } = useMutation({
    mutationFn: repayBorrowOffer,
    onSuccess: (result, amountToRepay) => {
      void addPendingTx({
        txid: result.txid,
        kind: 'repay_offer',
        walletScriptPubkey: scriptPubkey ?? '',
        offerId: offer.id,
        previousOfferStatus: 'active',
        amount: amountToRepay,
      })
    },
  })

  const { data: feeRate = FALLBACK_FEE_RATE_SAT_PER_KVB } = useQuery({
    queryKey: esploraQueryKeys.feeRate,
    queryFn: () => fetchFeeRateSatPerKvb(),
  })
  const feeBuffer =
    principalAsset.id === lwkNetwork.policyAsset().toString()
      ? estimateFeeBudgetSats(REPAY_WEIGHT_UNITS, feeRate)
      : 0n
  const principalBalance = BigInt(confirmedBalances[principalAsset.id] ?? 0)
  const spendable = principalBalance > feeBuffer ? principalBalance - feeBuffer : 0n

  const resolver = useMemo(
    () => zodResolver(createRepaySchema(offer.current_debt, spendable)),
    [offer.current_debt, spendable],
  )
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
  const remainingDebt =
    enteredAmount > 0n && enteredAmount <= offer.current_debt
      ? offer.current_debt - enteredAmount
      : null
  const offerParameters = {
    collateralAmount: toUint64(offer.collateral_amount, 'collateralAmount'),
    principalAmount: toUint64(offer.principal_amount, 'principalAmount'),
    principalInterestRate: toUint16(offer.interest_rate, 'principalInterestRate'),
  }
  const collateralReturned =
    remainingDebt === null
      ? null
      : getAlreadyUnlockedCollateral(offerParameters, toUint64(remainingDebt, 'remainingDebt')) -
        getAlreadyUnlockedCollateral(offerParameters, toUint64(offer.current_debt, 'currentDebt'))

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
      title={
        <>
          <span
            aria-hidden='true'
            className='bg-accent-soft text-accent-soft-foreground flex size-9 shrink-0 items-center justify-center rounded-full'
          >
            <HandArrowDownIcon className='size-4' />
          </span>
          <span className='text-h4 text-foreground'>Repay</span>
        </>
      }
      action={{
        label: 'Confirm',
        variant: 'primary',
        eyebrow: 'Repay Loan',
        summary: txSummary,
        status,
        disabled: !isValid,
        txid: data?.txid,
        onConfirm: () => void handleSubmit(values => mutate(values.amount))(),
      }}
      onClose={() => {
        reset()
        resetForm()
        onClose()
      }}
      onSuccess={onSuccess}
    >
      <div className='text-foreground flex flex-col gap-8'>
        <section className='bg-surface-secondary flex flex-col gap-3 rounded-xl p-6'>
          <span className='text-h4 text-muted'>Left to Repay</span>
          <p className='flex items-center gap-2'>
            <PrincipalIcon className='size-6 shrink-0' />
            <span className='text-display break-all'>
              {formatAmount(offer.current_debt, principalAsset.decimals)}
            </span>
            <span className='text-muted self-end pb-0.5 text-sm font-medium'>
              {principalAsset.symbol}
            </span>
          </p>
        </section>
        <section className='bg-surface-secondary flex flex-col gap-6 rounded-xl p-6'>
          <h4 className='text-muted text-xs'>Repay Details</h4>
          <div className='flex flex-col gap-3'>
            <Controller
              control={control}
              name='amount'
              render={({ field, fieldState }) => (
                <UiTextField
                  label={<UiFieldLabel required>Repayment Amount</UiFieldLabel>}
                  placeholder='0.00'
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  endContent={principalAsset.symbol}
                  onMax={() =>
                    field.onChange(formatAmountInput(offer.current_debt, principalAsset.decimals))
                  }
                  isMaxDisabled={enteredAmount === offer.current_debt}
                  errorMessage={fieldState.error?.message}
                />
              )}
            />
            <RepayPreviewRow label='Remaining Debt'>
              {remainingDebt === null ? '—' : formatPrincipalAmount(remainingDebt)}
            </RepayPreviewRow>
            <RepayPreviewRow label='Returned to You'>
              {collateralReturned === null ? (
                '—'
              ) : (
                <span className='text-success'>
                  + {formatCollateralDisplay(collateralReturned)}
                </span>
              )}
            </RepayPreviewRow>
          </div>
        </section>
      </div>
    </OfferActionShell>
  )
}
