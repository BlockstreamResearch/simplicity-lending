import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { z as zod } from 'zod'

import { useAssetPriceUsd } from '@/api/prices/hooks'
import BalanceCard from '@/components/BalanceCard'
import PlusIcon from '@/components/icons/PlusIcon'
import TriangleExclamationIcon from '@/components/icons/TriangleExclamationIcon'
import TransactionModal from '@/components/TransactionModal'
import { UiButton } from '@/components/ui/UiButton'
import { UiFieldLabel } from '@/components/ui/UiFieldLabel'
import { UiModal } from '@/components/ui/UiModal'
import { UiSelect } from '@/components/ui/UiSelect'
import { UiTextField } from '@/components/ui/UiTextField'
import { env } from '@/constants/env'
import { type ConfigAsset, NETWORK_CONFIG } from '@/constants/network-config'
import { BPS_DIVISOR } from '@/constants/offers'
import { useBorrowerAccount } from '@/hooks/useBorrowerAccount'
import { useCreateOffer } from '@/hooks/useCreateOffer'
import { useFeeRateSatPerKvb } from '@/hooks/useFeeRate'
import { useFreezeViewWhileOpen } from '@/hooks/useFreezeViewWhileOpen'
import { type PolicyAssetUtxo, usePolicyAssetUtxos } from '@/hooks/usePolicyAssetUtxos'
import { useStandardTransactionFlow } from '@/hooks/useStandardTransactionFlow'
import { estimateFeeBudgetSats, EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY } from '@/lwk/utxo'
import type { PolicyAssetDenomination } from '@/providers/assetDenomination/constants'
import { useAssetDenomination } from '@/providers/assetDenomination/useAssetDenomination'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useWallet } from '@/providers/wallet/useWallet'
import { ISSUANCE_FACTORY_MAX_WEIGHT_TO_SATISFY } from '@/simplicity/issuance-factory/program'
import { toBigintAmount } from '@/utils/bigint'
import { formatAmount, formatUsd } from '@/utils/format'
import { computeApr, computeLtv, daysToBlocks, feeToBps } from '@/utils/offers'
import {
  formatPolicyAssetDisplay,
  formatPolicyAssetInputValue,
  getPolicyAssetUnit,
  parsePolicyAssetInput,
} from '@/utils/policyAssetDenomination'
import { selectByLargestFirst } from '@/utils/utxo'

import { MAX_LTV } from '../helpers'
import LoanMetricsSummary from './LoanMetricsSummary'

const MINUTES_PER_DAY = 1440
const TERM_OPTIONS = [
  ...(env.DEV ? [{ id: 10 / MINUTES_PER_DAY, textValue: '10 minutes' }] : []),
  { id: 7, textValue: '7 days' },
  { id: 14, textValue: '14 days' },
  { id: 30, textValue: '30 days' },
  { id: 90, textValue: '90 days' },
]

const CREATE_OFFER_WEIGHT_UNITS =
  EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY + ISSUANCE_FACTORY_MAX_WEIGHT_TO_SATISFY.IssueAssets

interface BorrowOfferContext {
  collateralAsset: ConfigAsset
  collateralDenomination: PolicyAssetDenomination
  collateralUnit: string
  principalDecimals: number
  principalSymbol: string
  utxos: PolicyAssetUtxo[]
  feeBudgetSats: bigint
  collateralUsd: number | null
}
const MAX_INTEREST_RATE_BPS = 65_535
const MIN_PAYMENT_AMOUNT = 0.1

function parseAmount(
  ctx: zod.RefinementCtx,
  raw: string,
  path: 'collateral' | 'borrow' | 'fee',
  decimals: number,
  belowUnitMessage: string,
) {
  const value = raw.trim()
  const decimalRe = new RegExp(`^\\d+(\\.\\d{0,${decimals}})?$`)
  if (!decimalRe.test(value)) {
    ctx.addIssue({ code: zod.ZodIssueCode.custom, path: [path], message: 'Enter a valid amount' })
    return null
  }
  if (Number(value) <= 0) {
    ctx.addIssue({
      code: zod.ZodIssueCode.custom,
      path: [path],
      message: 'Enter a positive amount',
    })
    return null
  }
  const base = toBigintAmount(value, decimals)
  if (base <= 0n) {
    ctx.addIssue({ code: zod.ZodIssueCode.custom, path: [path], message: belowUnitMessage })
    return null
  }
  return base
}

function parsePolicyAssetCollateral(
  ctx: zod.RefinementCtx,
  raw: string,
  denomination: PolicyAssetDenomination,
  asset: ConfigAsset,
  unit: string,
) {
  const value = raw.trim()
  const base = parsePolicyAssetInput(value, denomination, asset)
  if (base === null) {
    ctx.addIssue({
      code: zod.ZodIssueCode.custom,
      path: ['collateral'],
      message: denomination === 'sats' ? `Enter a whole number of ${unit}` : 'Enter a valid amount',
    })
    return null
  }
  if (base <= 0n) {
    ctx.addIssue({
      code: zod.ZodIssueCode.custom,
      path: ['collateral'],
      message: `Enter a positive ${unit} amount`,
    })
    return null
  }
  return base
}

function createBorrowOfferSchema({
  collateralAsset,
  collateralDenomination,
  collateralUnit,
  principalDecimals,
  principalSymbol,
  utxos,
  feeBudgetSats,
  collateralUsd,
}: BorrowOfferContext) {
  const minPaymentBase = toBigintAmount(String(MIN_PAYMENT_AMOUNT), principalDecimals)

  return zod
    .object({
      collateral: zod.string(),
      borrow: zod.string(),
      fee: zod.string(),
      termDays: zod.number().optional(),
    })
    .superRefine((data, ctx) => {
      if (data.termDays === undefined) {
        ctx.addIssue({ code: zod.ZodIssueCode.custom, path: ['termDays'], message: 'Required' })
      }

      const collateralBase = parsePolicyAssetCollateral(
        ctx,
        data.collateral,
        collateralDenomination,
        collateralAsset,
        collateralUnit,
      )
      const principalBase = parseAmount(
        ctx,
        data.borrow,
        'borrow',
        principalDecimals,
        `Borrow amount is below the minimum ${principalSymbol} unit`,
      )
      const feeBase = parseAmount(
        ctx,
        data.fee,
        'fee',
        principalDecimals,
        `Fee is below the minimum ${principalSymbol} unit`,
      )

      if (collateralBase !== null && utxos.length > 0) {
        const collateralBalance = utxos.reduce((sum, utxo) => sum + utxo.value, 0n)
        const maxCollateral =
          collateralBalance > feeBudgetSats ? collateralBalance - feeBudgetSats : 0n
        if (collateralBase > maxCollateral) {
          const maxDisplay = formatPolicyAssetDisplay(
            maxCollateral,
            collateralDenomination,
            collateralAsset,
          )
          ctx.addIssue({
            code: zod.ZodIssueCode.custom,
            path: ['collateral'],
            message: `Amount exceeds max spendable (${maxDisplay}). The rest is reserved for network fees.`,
          })
        }
      }

      const borrowTooSmall = principalBase !== null && principalBase < minPaymentBase
      const feeTooSmall = feeBase !== null && feeBase < minPaymentBase
      if (borrowTooSmall) {
        ctx.addIssue({
          code: zod.ZodIssueCode.custom,
          path: ['borrow'],
          message: `Minimum borrow is ${MIN_PAYMENT_AMOUNT} ${principalSymbol}`,
        })
      }
      if (feeTooSmall) {
        ctx.addIssue({
          code: zod.ZodIssueCode.custom,
          path: ['fee'],
          message: `Minimum fee is ${MIN_PAYMENT_AMOUNT} ${principalSymbol}`,
        })
      }

      if (collateralBase === null || principalBase === null || feeBase === null) return
      if (borrowTooSmall || feeTooSmall) return

      const ltv = computeLtv({
        principal: principalBase,
        principalDecimals,
        collateral: collateralBase,
        collateralDecimals: collateralAsset.decimals,
        collateralUsd,
      })
      if (ltv !== null && ltv > MAX_LTV) {
        ctx.addIssue({
          code: zod.ZodIssueCode.custom,
          path: ['borrow'],
          message: `LTV exceeds the ${(MAX_LTV * 100).toFixed(0)}% maximum. Reduce the loan amount or add collateral.`,
        })
      }

      const feeBps = feeToBps(feeBase, principalBase)
      if (feeBps > MAX_INTEREST_RATE_BPS) {
        const maxFeeBase = (principalBase * BigInt(MAX_INTEREST_RATE_BPS + 1) - 1n) / BPS_DIVISOR
        const maxFee = `${formatAmount(maxFeeBase, principalDecimals)} ${principalSymbol}`
        ctx.addIssue({
          code: zod.ZodIssueCode.custom,
          path: ['fee'],
          message:
            `Fee is too high. Max fee for this borrow amount is ${maxFee} ` +
            `(${(MAX_INTEREST_RATE_BPS / 100).toFixed(2)}%).`,
        })
      }
    })
}

type CreateBorrowOfferValues = zod.infer<ReturnType<typeof createBorrowOfferSchema>>

interface CreateBorrowOfferModalProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onClose: () => void
}

export default function CreateBorrowOfferModal({
  isOpen,
  onOpenChange,
  onClose,
}: CreateBorrowOfferModalProps) {
  const { collateralAsset, principalAsset } = NETWORK_CONFIG
  const { balances, scriptPubkey } = useWallet()
  const { denomination } = useAssetDenomination()
  const collateralUnit = getPolicyAssetUnit(denomination, collateralAsset)
  const collateralUsd = useAssetPriceUsd(collateralAsset.id)
  const { utxos, isLoading: isLoadingUtxos } = usePolicyAssetUtxos(isOpen)
  const { factoryState, refetchFactory } = useBorrowerAccount()
  const { createOffer } = useCreateOffer()
  const runStandardTransactionFlow = useStandardTransactionFlow()
  const { addPendingTx, addSurfaceToast } = usePendingTransactions()
  const feeRate = useFeeRateSatPerKvb(isOpen)
  const feeBudgetSats = useMemo(
    () => estimateFeeBudgetSats(CREATE_OFFER_WEIGHT_UNITS, feeRate, Math.max(utxos.length, 1)),
    [feeRate, utxos.length],
  )

  const formContext = useMemo<BorrowOfferContext>(
    () => ({
      collateralAsset,
      collateralDenomination: denomination,
      collateralUnit,
      principalDecimals: principalAsset.decimals,
      principalSymbol: principalAsset.symbol,
      utxos: isLoadingUtxos ? [] : utxos,
      feeBudgetSats,
      collateralUsd,
    }),
    [
      collateralAsset,
      denomination,
      collateralUnit,
      principalAsset.decimals,
      principalAsset.symbol,
      utxos,
      isLoadingUtxos,
      feeBudgetSats,
      collateralUsd,
    ],
  )

  const resolver = useMemo(() => zodResolver(createBorrowOfferSchema(formContext)), [formContext])

  const {
    control,
    handleSubmit,
    reset: resetForm,
  } = useForm<CreateBorrowOfferValues>({
    resolver,
    mode: 'all',
    defaultValues: { collateral: '', borrow: '', fee: '', termDays: undefined },
  })

  const values = useWatch({ control })
  const collateralBase =
    parsePolicyAssetInput(values.collateral, denomination, collateralAsset) ?? 0n
  const principalBase = toBigintAmount(values.borrow, principalAsset.decimals)
  const feeBase = toBigintAmount(values.fee, principalAsset.decimals)
  const bps = feeToBps(feeBase, principalBase)
  const loanDurationBlocks = values.termDays ? daysToBlocks(values.termDays) : 0

  const confirmedBalance = utxos.reduce((sum, utxo) => sum + utxo.value, 0n)
  const collateralFiat = formatUsd(collateralBase, collateralAsset.decimals, collateralUsd)
  const applyMaxCollateral = useCallback(
    (onChange: (value: string) => void) => {
      const maxBase = confirmedBalance > feeBudgetSats ? confirmedBalance - feeBudgetSats : 0n
      onChange(formatPolicyAssetInputValue(maxBase, denomination, collateralAsset))
    },
    [confirmedBalance, feeBudgetSats, denomination, collateralAsset],
  )

  const createBorrowOffer = useCallback(async () => {
    const { txid } = await runStandardTransactionFlow(async () => {
      if (!factoryState) {
        throw new Error('No active factory found. Create a borrower account first.')
      }
      const collateralUtxos = selectByLargestFirst(utxos, collateralBase + feeBudgetSats)
      if (!collateralUtxos) throw new Error('No suitable collateral UTXOs found')

      return createOffer({
        factoryAuthOutpoint: factoryState.factoryAuthOutpoint,
        issuanceFactoryOutpoint: factoryState.issuanceFactoryOutpoint,
        factoryAssetId: factoryState.factoryAssetId,
        collateralOutpoints: collateralUtxos.map(utxo => utxo.outpoint),
        collateralAmount: collateralBase,
        principalAssetId: NETWORK_CONFIG.principalAsset.id,
        principalAmount: principalBase,
        principalInterestRate: bps,
        loanDurationBlocks,
        protocolFeeKeeperAssetId: NETWORK_CONFIG.principalAsset.id,
      })
    })

    refetchFactory()
    return txid
  }, [
    factoryState,
    utxos,
    collateralBase,
    feeBudgetSats,
    runStandardTransactionFlow,
    createOffer,
    principalBase,
    bps,
    loanDurationBlocks,
    refetchFactory,
  ])

  const { mutate, reset, data, status } = useMutation({
    mutationFn: createBorrowOffer,
    onSuccess: txid => {
      void addPendingTx({
        txid,
        kind: 'create_offer',
        walletScriptPubkey: scriptPubkey ?? '',
      })
    },
  })
  const apr = computeApr(bps, loanDurationBlocks)
  const ltv = computeLtv({
    principal: principalBase,
    principalDecimals: principalAsset.decimals,
    collateral: collateralBase,
    collateralDecimals: collateralAsset.decimals,
    collateralUsd,
  })
  const exceedsMaxLtv = ltv !== null && ltv > MAX_LTV

  const txSummary = useMemo(
    () => [
      { label: 'Borrow', value: `${values.borrow || '0'} ${principalAsset.symbol}` },
      {
        label: 'Collateral',
        value: formatPolicyAssetDisplay(collateralBase, denomination, collateralAsset),
      },
    ],
    [values.borrow, principalAsset.symbol, collateralBase, denomination, collateralAsset],
  )

  const view = useFreezeViewWhileOpen(isOpen, {
    status,
    summary: txSummary,
    txid: data,
  })

  const handleClose = () => {
    if (data) addSurfaceToast(data)
    reset()
    resetForm()
    onOpenChange(false)
    onClose()
  }

  const onSubmit = handleSubmit(() => mutate())

  if (view.status !== 'idle') {
    return (
      <TransactionModal
        isOpen={isOpen}
        eyebrow='New Offer'
        status={view.status}
        summary={view.summary}
        txid={view.txid}
        onClose={handleClose}
      />
    )
  }

  return (
    <UiModal
      isOpen={isOpen}
      onOpenChange={open => {
        if (!open) handleClose()
      }}
      title='Create Borrow Offer'
      dialogClassName='max-w-162 sm:max-w-[min(40.5rem,calc(100vw_-_5rem))]'
      footer={
        <div className='flex w-full gap-2'>
          <UiButton className='flex-1' variant='secondary' onPress={handleClose}>
            Cancel
          </UiButton>
          <UiButton
            className='flex-1'
            variant='primary'
            isDisabled={exceedsMaxLtv}
            onPress={() => void onSubmit()}
          >
            <PlusIcon className='size-4' />
            Create Borrow Offer
          </UiButton>
        </div>
      }
    >
      <div className='flex flex-col gap-5'>
        <BalanceCard
          asset={collateralAsset}
          amount={BigInt(balances[collateralAsset.id] ?? 0)}
          className='bg-surface-secondary'
        />
        <Controller
          control={control}
          name='collateral'
          render={({ field, fieldState }) => (
            <UiTextField
              label={
                <UiFieldLabel
                  required
                  tooltip={`The ${collateralAsset.symbol} you lock to back the loan. It stays locked until you repay the loan or cancel the offer.`}
                >
                  Collateral to Lock
                </UiFieldLabel>
              }
              placeholder={denomination === 'sats' ? '0' : '0.00'}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              endContent={collateralUnit}
              onMax={() => applyMaxCollateral(field.onChange)}
              isMaxDisabled={isLoadingUtxos || confirmedBalance <= feeBudgetSats}
              description={collateralFiat ? `Collateral Value = ${collateralFiat} USD` : undefined}
              errorMessage={fieldState.error?.message}
            />
          )}
        />
        <Controller
          control={control}
          name='borrow'
          render={({ field, fieldState }) => (
            <UiTextField
              label={
                <UiFieldLabel
                  required
                  tooltip={`The amount you want to borrow in ${principalAsset.symbol}, sent to you once a lender funds the offer.`}
                >
                  Loan Amount
                </UiFieldLabel>
              }
              placeholder='0.00'
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              endContent={principalAsset.symbol}
              errorMessage={fieldState.error?.message}
            />
          )}
        />
        <div className='flex flex-col gap-5 sm:flex-row'>
          <div className='flex-1'>
            <Controller
              control={control}
              name='fee'
              render={({ field, fieldState }) => (
                <UiTextField
                  label={
                    <UiFieldLabel
                      required
                      tooltip={`The interest you pay the lender on top of the borrowed amount, in ${principalAsset.symbol}.`}
                    >
                      Fee
                    </UiFieldLabel>
                  }
                  placeholder='0.00'
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  endContent={principalAsset.symbol}
                  errorMessage={fieldState.error?.message}
                />
              )}
            />
          </div>
          <div className='flex-1'>
            <Controller
              control={control}
              name='termDays'
              render={({ field, fieldState }) => (
                <UiSelect
                  label={
                    <UiFieldLabel
                      required
                      tooltip="How long the loan runs. Repay in full before it ends to unlock your collateral; if you don't, the lender can claim it."
                    >
                      Term
                    </UiFieldLabel>
                  }
                  placeholder='Select one'
                  options={TERM_OPTIONS}
                  value={field.value}
                  onChange={key => field.onChange(Number(key))}
                  errorMessage={fieldState.error?.message}
                />
              )}
            />
          </div>
        </div>

        <LoanMetricsSummary apr={apr} ltv={ltv} />

        <div className='border-warning bg-warning/15 text-muted flex items-center gap-3 rounded-xl border-2 p-3 text-sm font-medium'>
          <TriangleExclamationIcon className='text-warning size-6 shrink-0' />
          Your collateral will be locked until the offer is repaid or cancelled.
        </div>
      </div>
    </UiModal>
  )
}
