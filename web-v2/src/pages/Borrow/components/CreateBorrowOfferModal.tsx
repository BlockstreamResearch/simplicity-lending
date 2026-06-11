import { useMemo } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'

import { getTxExplorerUrl } from '@/api/esplora/utils'
import PlusIcon from '@/components/icons/PlusIcon'
import TransactionModal from '@/components/TransactionModal'
import { UiButton } from '@/components/ui/UiButton'
import { UiFieldLabel } from '@/components/ui/UiFieldLabel'
import { UiModal } from '@/components/ui/UiModal'
import { UiSelect } from '@/components/ui/UiSelect'
import { UiTextField } from '@/components/ui/UiTextField'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { usePolicyAssetUtxos, type WalletUtxo } from '@/hooks/usePolicyAssetUtxos'
import { useTransaction } from '@/hooks/useTransaction'
import { useNotifications } from '@/providers/notifications/NotificationsContext'
import { useWallet } from '@/providers/wallet/useWallet'
import { parseBaseUnits } from '@/utils/format'
import { computeApr, computeLtv, daysToBlocks, feeToBps } from '@/utils/offers'
import { createZodResolver } from '@/utils/zod'

import { MAX_LTV, pickCollateralUtxo, TERM_OPTIONS } from '../helpers'
import { useCreateBorrowOffer } from '../hooks/useCreateBorrowOffer'
import BalanceCard from './BalanceCard'
import LoanInfo from './LoanInfo'

interface BorrowOfferContext {
  collateralDecimals: number
  collateralUsd: number | null
  utxos: WalletUtxo[]
}

const positiveAmount = z
  .string()
  .trim()
  .refine(v => Number(v) > 0, 'Enter a positive amount')

function createBorrowOfferSchema({ collateralDecimals, collateralUsd, utxos }: BorrowOfferContext) {
  return z
    .object({
      collateral: positiveAmount,
      borrow: positiveAmount,
      fee: positiveAmount,
      termDays: z.number().int().positive(),
    })
    .superRefine((data, ctx) => {
      const collateral = Number(data.collateral)
      const borrow = Number(data.borrow)
      if (!collateral || !borrow) return

      const ltv = computeLtv(borrow, collateral, collateralUsd)
      if (ltv !== null && ltv > MAX_LTV) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['borrow'],
          message: `LTV ${(ltv * 100).toFixed(1)}% exceeds maximum ${(MAX_LTV * 100).toFixed(0)}%`,
        })
      }

      if (utxos.length > 0) {
        const collateralBase = parseBaseUnits(data.collateral, collateralDecimals)
        if (!utxos.some(u => u.value >= collateralBase)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['collateral'],
            message: 'No single UTXO large enough for this collateral',
          })
        }
      }
    })
}

type CreateBorrowOfferValues = z.infer<ReturnType<typeof createBorrowOfferSchema>>

const createBorrowOfferResolver = createZodResolver<CreateBorrowOfferValues, BorrowOfferContext>(
  createBorrowOfferSchema,
)

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
  const { submit } = useCreateBorrowOffer()
  const { notify } = useNotifications()
  const { phase, txid, error, execute, resetTx } = useTransaction()

  const formContext = useMemo<BorrowOfferContext>(
    () => ({
      collateralDecimals: collateralAsset.decimals,
      collateralUsd,
      utxos: isLoadingUtxos ? [] : utxos,
    }),
    [collateralAsset.decimals, collateralUsd, utxos, isLoadingUtxos],
  )

  const { control, handleSubmit, reset } = useForm<CreateBorrowOfferValues, BorrowOfferContext>({
    resolver: createBorrowOfferResolver,
    context: formContext,
    defaultValues: { collateral: '', borrow: '', fee: '', termDays: undefined },
  })

  const values = useWatch({ control })
  const collateralBase = parseBaseUnits(values.collateral, collateralAsset.decimals)
  const principalBase = parseBaseUnits(values.borrow, principalAsset.decimals)
  const feeBase = parseBaseUnits(values.fee, principalAsset.decimals)
  const bps = feeToBps(feeBase, principalBase)
  const loanDurationBlocks = values.termDays ? daysToBlocks(values.termDays) : 0
  const apr = computeApr(bps, loanDurationBlocks)
  const ltv = computeLtv(Number(values.borrow), Number(values.collateral), collateralUsd)

  const handleClose = () => {
    resetTx()
    reset()
    onOpenChange(false)
  }

  const onSubmit = handleSubmit(async () => {
    const collateralUtxo = pickCollateralUtxo(utxos, collateralBase)
    if (!collateralUtxo) return
    await execute(async () => {
      const result = await submit({
        collateralOutpoint: collateralUtxo.outpoint,
        collateralAmount: collateralBase,
        principalAmount: principalBase,
        principalInterestRate: bps,
        loanDurationBlocks,
      })
      notify({
        variant: 'success',
        title: 'Offer Created',
        description: 'Your loan offer has been created successfully.',
        action: {
          label: 'Details',
          onPress: () => window.open(getTxExplorerUrl(result.txid), '_blank', 'noopener'),
        },
      })
      return result.txid
    })
  })

  if (phase !== 'idle') {
    return (
      <TransactionModal
        isOpen={isOpen}
        eyebrow='New Offer'
        phase={phase}
        summary={[
          { label: 'Borrow', value: `${values.borrow || '0'} ${principalAsset.symbol}` },
          { label: 'Collateral', value: `${values.collateral || '0'} ${collateralAsset.symbol}` },
        ]}
        txid={txid}
        errorMessage={error}
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
      <div className='flex flex-col gap-8'>
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
              label={<UiFieldLabel>Collateral</UiFieldLabel>}
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
              label={<UiFieldLabel>Borrow</UiFieldLabel>}
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
                  label={<UiFieldLabel>Fee</UiFieldLabel>}
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
                  label={<UiFieldLabel>Duration/Term</UiFieldLabel>}
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

        <LoanInfo apr={apr} ltv={ltv} />
      </div>
    </UiModal>
  )
}
