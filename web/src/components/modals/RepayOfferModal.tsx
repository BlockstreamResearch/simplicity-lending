import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
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
import DetailsPanel from '@/components/DetailsPanel'
import HandArrowDownIcon from '@/components/icons/HandArrowDownIcon'
import OfferActionShell from '@/components/modals/OfferActionShell'
import { UiFieldLabel } from '@/components/ui/UiFieldLabel'
import { UiTextField } from '@/components/ui/UiTextField'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { BPS_DIVISOR, PROTOCOL_FEE_BPS } from '@/constants/offers'
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
import {
  getAlreadyUnlockedCollateral,
  getRepaymentPhase,
  getRepaymentSplit,
} from '@/simplicity/lending/utils'
import { toBigintAmount } from '@/utils/bigint'
import { DECIMAL_AMOUNT_RE, formatAmount, formatAmountInput } from '@/utils/format'
import { toUint16, toUint64 } from '@/utils/uint'

const REPAY_WEIGHT_UNITS =
  LENDING_MAX_WEIGHT_TO_SATISFY.FullRepayment + EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY

const MIN_FIRST_REPAYMENT = (BPS_DIVISOR + BigInt(PROTOCOL_FEE_BPS) - 1n) / BigInt(PROTOCOL_FEE_BPS)

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

function createRepaySchema(
  currentDebt: bigint,
  spendable: bigint,
  terms: Parameters<typeof getRepaymentSplit>[0],
) {
  const { decimals, symbol } = NETWORK_CONFIG.principalAsset
  const formatPrincipal = (amount: bigint) => `${formatAmount(amount, decimals)} ${symbol}`
  const debt = toUint64(currentDebt, 'currentDebt')
  const isFirstRepayment = getRepaymentPhase(terms, debt) === 'NoRepayments'

  return zod.object({
    amount: principalAmountSchema.pipe(
      zod
        .bigint()
        .positive('Enter a positive amount')
        .max(currentDebt, `Amount exceeds the debt left to repay (${formatPrincipal(currentDebt)})`)
        .max(spendable, `Insufficient ${symbol} balance (${formatPrincipal(spendable)} available)`)
        .refine(
          amount =>
            !isFirstRepayment ||
            amount > currentDebt ||
            getRepaymentSplit(terms, debt, toUint64(amount, 'amountToRepay')).protocolFee > 0n,
          `The first payment must be at least ${formatPrincipal(MIN_FIRST_REPAYMENT)}`,
        ),
    ),
  })
}

interface RepaySubmission {
  amount: bigint
  remainingDebt: bigint
  collateralReturned: bigint
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

  const { mutate, reset, data, status, variables } = useMutation({
    mutationFn: (submission: RepaySubmission) => repayBorrowOffer(submission.amount),
    onSuccess: (result, submission) => {
      void addPendingTx({
        txid: result.txid,
        kind: 'repay_offer',
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
  const feeBuffer =
    principalAsset.id === lwkNetwork.policyAsset().toString()
      ? estimateFeeBudgetSats(REPAY_WEIGHT_UNITS, feeRate)
      : 0n
  const principalBalance = BigInt(confirmedBalances[principalAsset.id] ?? 0)
  const spendable = principalBalance > feeBuffer ? principalBalance - feeBuffer : 0n
  const maxAmount = spendable < offer.current_debt ? spendable : offer.current_debt

  const offerParameters = useMemo(
    () => ({
      collateralAmount: toUint64(offer.collateral_amount, 'collateralAmount'),
      principalAmount: toUint64(offer.principal_amount, 'principalAmount'),
      principalInterestRate: toUint16(offer.interest_rate, 'principalInterestRate'),
    }),
    [offer.collateral_amount, offer.principal_amount, offer.interest_rate],
  )
  const getCollateralReturned = (remainingDebt: bigint) =>
    getAlreadyUnlockedCollateral(offerParameters, toUint64(remainingDebt, 'remainingDebt')) -
    getAlreadyUnlockedCollateral(offerParameters, toUint64(offer.current_debt, 'currentDebt'))

  const resolver = useMemo(
    () => zodResolver(createRepaySchema(offer.current_debt, spendable, offerParameters)),
    [offer.current_debt, spendable, offerParameters],
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
  const collateralReturned = remainingDebt === null ? null : getCollateralReturned(remainingDebt)
  const actionLabel = !isValid
    ? 'Repay'
    : enteredAmount === offer.current_debt
      ? 'Repay in Full'
      : `Repay ${formatPrincipalAmount(enteredAmount)}`

  const txSummary = useMemo(
    () =>
      variables
        ? [
            { label: 'Repaid', value: formatPrincipalAmount(variables.amount) },
            { label: 'Remaining Debt', value: formatPrincipalAmount(variables.remainingDebt) },
            {
              label: 'Collateral Returned',
              value: formatCollateralDisplay(variables.collateralReturned),
            },
          ]
        : [],
    [variables, formatPrincipalAmount, formatCollateralDisplay],
  )

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
        label: actionLabel,
        variant: 'primary',
        eyebrow: 'Repay Loan',
        summary: txSummary,
        status,
        disabled: !isValid,
        txid: data?.txid,
        onConfirm: () =>
          void handleSubmit(({ amount }) => {
            const debtAfter = offer.current_debt - amount
            mutate({
              amount,
              remainingDebt: debtAfter,
              collateralReturned: getCollateralReturned(debtAfter),
            })
          })(),
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
                onMax={() => field.onChange(formatAmountInput(maxAmount, principalAsset.decimals))}
                isMaxDisabled={maxAmount === 0n || enteredAmount === maxAmount}
                errorMessage={fieldState.error?.message}
              />
            )}
          />
        </section>
        <DetailsPanel
          title='After This Payment'
          rows={[
            {
              label: 'Remaining Debt',
              value: remainingDebt === null ? '—' : formatPrincipalAmount(remainingDebt),
            },
            {
              label: 'Returned to You',
              value:
                collateralReturned === null ? (
                  '—'
                ) : (
                  <span className='text-success'>
                    + {formatCollateralDisplay(collateralReturned)}
                  </span>
                ),
            },
          ]}
        />
      </div>
    </OfferActionShell>
  )
}
