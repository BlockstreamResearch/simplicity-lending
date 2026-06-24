import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'

import { useAssetPriceUsd } from '@/api/prices/hooks'
import BalanceCard from '@/components/BalanceCard'
import PlusIcon from '@/components/icons/PlusIcon'
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
import { estimateFeeBudgetSats, EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY } from '@/lwk/utxo'
import type { PolicyAssetDenomination } from '@/providers/assetDenomination/types'
import { useAssetDenomination } from '@/providers/assetDenomination/useAssetDenomination'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useWallet } from '@/providers/wallet/useWallet'
import { ISSUANCE_FACTORY_MAX_WEIGHT_TO_SATISFY } from '@/simplicity/issuance-factory/program'
import { toBigintAmount } from '@/utils/bigint'
import { DECIMAL_AMOUNT_RE, formatAmount } from '@/utils/format'
import { computeApr, computeLtv, daysToBlocks, feeToBps } from '@/utils/offers'
import {
  formatPolicyAssetDisplay,
  formatPolicyAssetInputValue,
  getPolicyAssetUnit,
  parsePolicyAssetInput,
} from '@/utils/policyAssetDenomination'
import { selectByLargestFirst } from '@/utils/utxo'

import LoanMetricsSummary from './LoanMetricsSummary'

const MAX_LTV = 0.55
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
  collateralDecimals: number
  collateralDenomination: PolicyAssetDenomination
  collateralUnit: string
  principalDecimals: number
  principalSymbol: string
  collateralUsd: number | null
  utxos: PolicyAssetUtxo[]
  feeBudgetSats: bigint
}
const MAX_INTEREST_RATE_BPS = 65_535
const MIN_PAYMENT_AMOUNT = 0.1

const positiveAmount = z
  .string()
  .trim()
  .regex(DECIMAL_AMOUNT_RE, 'Enter a valid amount')
  .refine(v => Number(v) > 0, 'Enter a positive amount')

function createBorrowOfferSchema({
  collateralAsset,
  collateralDecimals,
  collateralDenomination,
  collateralUnit,
  principalDecimals,
  principalSymbol,
  collateralUsd,
  utxos,
  feeBudgetSats,
}: BorrowOfferContext) {
  return z
    .object({
      collateral: z
        .string()
        .trim()
        .min(1, 'Enter a valid amount')
        .refine(
          v => parsePolicyAssetInput(v, collateralDenomination, collateralAsset) !== null,
          collateralDenomination === 'sats'
            ? 'Enter a whole number of sats'
            : 'Enter a valid amount',
        )
        .refine(
          v => (parsePolicyAssetInput(v, collateralDenomination, collateralAsset) ?? 0n) > 0n,
          `Enter a positive ${collateralUnit} amount`,
        ),
      borrow: positiveAmount,
      fee: positiveAmount,
      termDays: z.number().positive(),
    })
    .superRefine((data, ctx) => {
      const collateralBase =
        parsePolicyAssetInput(data.collateral, collateralDenomination, collateralAsset) ?? 0n
      const principalBase = toBigintAmount(data.borrow, principalDecimals)
      const feeBase = toBigintAmount(data.fee, principalDecimals)
      if (collateralBase <= 0n) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['collateral'],
          message: 'Collateral is below the minimum asset unit',
        })
      }
      if (principalBase <= 0n) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['borrow'],
          message: `Borrow amount is below the minimum ${principalSymbol} unit`,
        })
      }
      if (feeBase <= 0n) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['fee'],
          message: `Fee is below the minimum ${principalSymbol} unit`,
        })
      }
      if (collateralBase <= 0n || principalBase <= 0n || feeBase <= 0n) return

      if (Number(data.borrow) < MIN_PAYMENT_AMOUNT) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['borrow'],
          message: `Minimum borrow is ${MIN_PAYMENT_AMOUNT} ${principalSymbol}`,
        })
      }
      if (Number(data.fee) < MIN_PAYMENT_AMOUNT) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['fee'],
          message: `Minimum fee is ${MIN_PAYMENT_AMOUNT} ${principalSymbol}`,
        })
      }
      if (Number(data.borrow) < MIN_PAYMENT_AMOUNT || Number(data.fee) < MIN_PAYMENT_AMOUNT) return

      const feeBps = feeToBps(feeBase, principalBase)
      if (feeBps > MAX_INTEREST_RATE_BPS) {
        const maxFeeBase = (principalBase * BigInt(MAX_INTEREST_RATE_BPS + 1) - 1n) / BPS_DIVISOR
        const maxFee = `${formatAmount(maxFeeBase, principalDecimals)} ${principalSymbol}`
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['fee'],
          message:
            `Fee is too high. Max fee for this borrow amount is ${maxFee} ` +
            `(${(MAX_INTEREST_RATE_BPS / 100).toFixed(2)}%).`,
        })
      }

      const ltv = computeLtv({
        principal: principalBase,
        principalDecimals,
        collateral: collateralBase,
        collateralDecimals,
        collateralUsd,
      })
      if (ltv !== null && ltv > MAX_LTV) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['borrow'],
          message: `LTV ${(ltv * 100).toFixed(1)}% exceeds maximum ${(MAX_LTV * 100).toFixed(0)}%`,
        })
      }

      const collateralBalance = utxos.reduce((sum, utxo) => sum + utxo.value, 0n)
      if (utxos.length > 0 && collateralBalance < collateralBase + feeBudgetSats) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['collateral'],
          message: 'Not enough Policy Asset UTXO balance for collateral and fees',
        })
      }
    })
}

type CreateBorrowOfferValues = z.infer<ReturnType<typeof createBorrowOfferSchema>>

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
  const { addPendingTx, addSurfaceToast } = usePendingTransactions()
  const feeRate = useFeeRateSatPerKvb(isOpen)
  const feeBudgetSats = useMemo(
    () => estimateFeeBudgetSats(CREATE_OFFER_WEIGHT_UNITS, feeRate),
    [feeRate],
  )

  const formContext = useMemo<BorrowOfferContext>(
    () => ({
      collateralAsset,
      collateralDecimals: collateralAsset.decimals,
      collateralDenomination: denomination,
      collateralUnit,
      principalDecimals: principalAsset.decimals,
      principalSymbol: principalAsset.symbol,
      collateralUsd,
      utxos: isLoadingUtxos ? [] : utxos,
      feeBudgetSats,
    }),
    [
      collateralAsset,
      denomination,
      collateralUnit,
      principalAsset.decimals,
      principalAsset.symbol,
      collateralUsd,
      utxos,
      isLoadingUtxos,
      feeBudgetSats,
    ],
  )

  const resolver = useMemo(() => zodResolver(createBorrowOfferSchema(formContext)), [formContext])

  const {
    control,
    handleSubmit,
    reset: resetForm,
    setValue,
  } = useForm<CreateBorrowOfferValues>({
    resolver,
    defaultValues: { collateral: '', borrow: '', fee: '', termDays: undefined },
  })

  const values = useWatch({ control })
  const previousDenominationRef = useRef(denomination)
  const collateralBase =
    parsePolicyAssetInput(values.collateral, denomination, collateralAsset) ?? 0n
  const principalBase = toBigintAmount(values.borrow, principalAsset.decimals)
  const feeBase = toBigintAmount(values.fee, principalAsset.decimals)
  const bps = feeToBps(feeBase, principalBase)
  const loanDurationBlocks = values.termDays ? daysToBlocks(values.termDays) : 0

  useEffect(() => {
    const previousDenomination = previousDenominationRef.current
    if (previousDenomination === denomination) return

    const currentCollateral = values.collateral?.trim()
    if (currentCollateral) {
      const previousBase = parsePolicyAssetInput(
        currentCollateral,
        previousDenomination,
        collateralAsset,
      )
      if (previousBase !== null) {
        setValue(
          'collateral',
          formatPolicyAssetInputValue(previousBase, denomination, collateralAsset),
          { shouldValidate: true },
        )
      }
    }

    previousDenominationRef.current = denomination
  }, [collateralAsset, denomination, setValue, values.collateral])

  const createBorrowOffer = useCallback(async () => {
    if (!factoryState) throw new Error('No active factory found. Create a borrower account first.')
    const collateralUtxos = selectByLargestFirst(utxos, collateralBase + feeBudgetSats)
    if (!collateralUtxos) throw new Error('No suitable collateral UTXOs found')
    const result = await createOffer({
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
    refetchFactory()
    return result.txid
  }, [
    factoryState,
    utxos,
    collateralBase,
    feeBudgetSats,
    principalBase,
    bps,
    loanDurationBlocks,
    refetchFactory,
    createOffer,
  ])

  const { mutate, reset, data, error, status } = useMutation({
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

  const liveErrorMessage = error?.message
  const view = useFreezeViewWhileOpen(isOpen, {
    status,
    summary: txSummary,
    txid: data,
    errorMessage: liveErrorMessage,
  })

  const handleClose = () => {
    if (data) addSurfaceToast(data)
    reset()
    resetForm()
    onOpenChange(false)
    onClose()
  }

  const onSubmit = handleSubmit(() => {
    mutate()
  })

  if (view.status !== 'idle') {
    return (
      <TransactionModal
        isOpen={isOpen}
        eyebrow='New Offer'
        status={view.status}
        summary={view.summary}
        txid={view.txid}
        errorMessage={view.errorMessage}
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
      size='lg'
      footer={
        <div className='flex w-full gap-2'>
          <UiButton className='flex-1' variant='secondary' onPress={handleClose}>
            Cancel
          </UiButton>
          <UiButton className='flex-1' variant='primary' onPress={() => void onSubmit()}>
            <PlusIcon className='size-4' />
            Create Borrow Offer
          </UiButton>
        </div>
      }
    >
      <div className='flex flex-col gap-6'>
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
              label={<UiFieldLabel required>Collateral</UiFieldLabel>}
              placeholder={denomination === 'sats' ? '1000000' : '0.00'}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              endContent={collateralUnit}
              errorMessage={fieldState.error?.message}
            />
          )}
        />
        <Controller
          control={control}
          name='borrow'
          render={({ field, fieldState }) => (
            <UiTextField
              label={<UiFieldLabel required>Borrow</UiFieldLabel>}
              placeholder='0.00'
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              endContent={principalAsset.symbol}
              errorMessage={fieldState.error?.message}
            />
          )}
        />
        <div className='flex flex-col gap-8 sm:flex-row'>
          <div className='flex-1'>
            <Controller
              control={control}
              name='fee'
              render={({ field, fieldState }) => (
                <UiTextField
                  label={<UiFieldLabel required>Fee</UiFieldLabel>}
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
                  label={<UiFieldLabel required>Duration/Term</UiFieldLabel>}
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
      </div>
    </UiModal>
  )
}
