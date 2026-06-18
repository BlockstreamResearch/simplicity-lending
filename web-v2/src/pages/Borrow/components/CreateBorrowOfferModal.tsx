import { Toast } from '@heroui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'

import { getTxExplorerUrl } from '@/api/esplora/utils'
import BalanceCard from '@/components/BalanceCard'
import PlusIcon from '@/components/icons/PlusIcon'
import TransactionModal from '@/components/TransactionModal'
import { UiButton } from '@/components/ui/UiButton'
import { UiFieldLabel } from '@/components/ui/UiFieldLabel'
import { UiModal } from '@/components/ui/UiModal'
import { UiSelect } from '@/components/ui/UiSelect'
import { UiTextField } from '@/components/ui/UiTextField'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useBorrowerAccount } from '@/hooks/useBorrowerAccount'
import { useCreateOffer } from '@/hooks/useCreateOffer'
import { type PolicyAssetUtxo, usePolicyAssetUtxos } from '@/hooks/usePolicyAssetUtxos'
import { useWallet } from '@/providers/wallet/useWallet'
import { toBigintAmount } from '@/utils/bigint'
import { DECIMAL_AMOUNT_RE } from '@/utils/format'
import { computeApr, computeLtv, daysToBlocks, feeToBps } from '@/utils/offers'
import { selectOptimalUtxo } from '@/utils/utxo'

import { MAX_LTV, TERM_OPTIONS } from '../helpers'
import LoanMetricsSummary from './LoanMetricsSummary'

interface BorrowOfferContext {
  collateralDecimals: number
  principalDecimals: number
  collateralUsd: number | null
  utxos: PolicyAssetUtxo[]
}

const positiveAmount = z
  .string()
  .trim()
  .regex(DECIMAL_AMOUNT_RE, 'Enter a valid amount')
  .refine(v => Number(v) > 0, 'Enter a positive amount')

function createBorrowOfferSchema({
  collateralDecimals,
  principalDecimals,
  collateralUsd,
  utxos,
}: BorrowOfferContext) {
  return z
    .object({
      collateral: positiveAmount,
      borrow: positiveAmount,
      fee: positiveAmount,
      termDays: z.number().int().positive(),
    })
    .superRefine((data, ctx) => {
      const collateralBase = toBigintAmount(data.collateral, collateralDecimals)
      const principalBase = toBigintAmount(data.borrow, principalDecimals)
      if (!collateralBase || !principalBase) return

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

      if (utxos.length > 0 && !utxos.some(u => u.value >= collateralBase)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['collateral'],
          message: 'No single Policy Asset UTXO large enough for this transaction',
        })
      }
    })
}

type CreateBorrowOfferValues = z.infer<ReturnType<typeof createBorrowOfferSchema>>

interface CreateBorrowOfferModalProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}

export default function CreateBorrowOfferModal({
  isOpen,
  onOpenChange,
}: CreateBorrowOfferModalProps) {
  const { collateralAsset, principalAsset } = NETWORK_CONFIG
  const { balances } = useWallet()
  // TODO: implement price feed
  const collateralUsd = null
  const { utxos, isLoading: isLoadingUtxos } = usePolicyAssetUtxos(isOpen)
  const { factoryState, refetchFactory } = useBorrowerAccount()
  const { createOffer } = useCreateOffer()

  const formContext = useMemo<BorrowOfferContext>(
    () => ({
      collateralDecimals: collateralAsset.decimals,
      principalDecimals: principalAsset.decimals,
      collateralUsd,
      utxos: isLoadingUtxos ? [] : utxos,
    }),
    [collateralAsset.decimals, principalAsset.decimals, collateralUsd, utxos, isLoadingUtxos],
  )

  const resolver = useMemo(() => zodResolver(createBorrowOfferSchema(formContext)), [formContext])

  const {
    control,
    handleSubmit,
    reset: resetForm,
  } = useForm<CreateBorrowOfferValues>({
    resolver,
    defaultValues: { collateral: '', borrow: '', fee: '', termDays: undefined },
  })

  const values = useWatch({ control })
  const collateralBase = toBigintAmount(values.collateral, collateralAsset.decimals)
  const principalBase = toBigintAmount(values.borrow, principalAsset.decimals)
  const feeBase = toBigintAmount(values.fee, principalAsset.decimals)
  const bps = feeToBps(feeBase, principalBase)
  const loanDurationBlocks = values.termDays ? daysToBlocks(values.termDays) : 0

  const createBorrowOffer = useCallback(async () => {
    if (!factoryState) throw new Error('No active factory found. Create a borrower account first.')
    const collateralUtxo = selectOptimalUtxo(utxos, collateralBase)
    if (!collateralUtxo) throw new Error('No suitable collateral UTXO found')
    const result = await createOffer({
      factoryAuthOutpoint: factoryState.factoryAuthOutpoint,
      issuanceFactoryOutpoint: factoryState.issuanceFactoryOutpoint,
      factoryAssetId: factoryState.factoryAssetId,
      collateralOutpoint: collateralUtxo.outpoint,
      collateralAmount: collateralBase,
      principalAssetId: NETWORK_CONFIG.principalAsset.id,
      principalAmount: principalBase,
      principalInterestRate: bps,
      loanDurationBlocks,
      protocolFeeKeeperAssetId: NETWORK_CONFIG.principalAsset.id,
    })
    refetchFactory()
    Toast.toast.success('Offer Created', {
      description: 'Your loan offer has been created successfully.',
      actionProps: {
        children: 'Details',
        onPress: () => window.open(getTxExplorerUrl(result.txid), '_blank', 'noopener'),
      },
    })
    return result.txid
  }, [
    factoryState,
    utxos,
    collateralBase,
    principalBase,
    bps,
    loanDurationBlocks,
    refetchFactory,
    createOffer,
  ])

  const { mutate, reset, data, error, status } = useMutation({
    mutationFn: createBorrowOffer,
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
      { label: 'Collateral', value: `${values.collateral || '0'} ${collateralAsset.symbol}` },
    ],
    [values.borrow, values.collateral, principalAsset.symbol, collateralAsset.symbol],
  )

  const handleClose = () => {
    reset()
    resetForm()
    onOpenChange(false)
  }

  const onSubmit = handleSubmit(() => {
    mutate()
  })

  if (status !== 'idle') {
    return (
      <TransactionModal
        isOpen={isOpen}
        eyebrow='New Offer'
        status={status}
        summary={txSummary}
        txid={data}
        errorMessage={error?.message}
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
              placeholder='0.00'
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              endContent={collateralAsset.symbol}
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
                  selectedKey={field.value ?? null}
                  onSelectionChange={key => field.onChange(Number(key))}
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
