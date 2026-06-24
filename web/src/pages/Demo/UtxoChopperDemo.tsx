import type { WalletTxOut } from '@lilbonekit/lwk-web'
import { type ComponentProps, useCallback, useEffect, useMemo, useState } from 'react'
import { Controller, type Resolver, useForm, useWatch } from 'react-hook-form'
import { z as zod } from 'zod'

import { UiButton } from '@/components/ui/UiButton'
import { UiSelect } from '@/components/ui/UiSelect'
import { UiTextField } from '@/components/ui/UiTextField'
import { useTxStatus } from '@/hooks/useTxStatus'
import { type ChopUtxoResult, useUtxoChopper } from '@/hooks/useUtxoChopper'
import { isConfirmedWalletUtxo, isPolicyAssetUtxo, utxoToOutpointString } from '@/lwk/utxo'
import { useLwk } from '@/providers/lwk/useLwk'
import { useWallet } from '@/providers/wallet/useWallet'

import { formatCollateralUtxoOption } from './helpers'
import { TxResult } from './TxResult'

const outpointSchema = (label: string) =>
  zod
    .string()
    .trim()
    .regex(/^[0-9a-fA-F]{64}:\d+$/, `${label} must have txid:vout format`)
    .transform(value => value.toLowerCase())

const outpointListSchema = (label: string) =>
  zod
    .string()
    .trim()
    .transform(value => (value ? value.split(/[\s,]+/).filter(Boolean) : []))
    .pipe(zod.array(outpointSchema(label)))

const positiveBigIntStringSchema = (label: string) =>
  zod
    .string()
    .trim()
    .regex(/^\d+$/, `${label} must be a positive integer`)
    .transform(value => BigInt(value))
    .refine(value => value > 0n, `${label} must be greater than zero`)

const positiveIntegerStringSchema = (label: string) =>
  zod
    .string()
    .trim()
    .regex(/^\d+$/, `${label} must be a positive integer`)
    .transform(value => Number.parseInt(value, 10))
    .refine(value => value > 0, `${label} must be greater than zero`)
    .refine(value => value <= 100, `${label} must be 100 or less`)

const utxoChopperFormSchema = zod.object({
  fundingOutpoint: outpointSchema('Funding outpoint'),
  feeOutpoints: outpointListSchema('Fee L-BTC outpoint'),
  pieceAmount: positiveBigIntStringSchema('Piece amount'),
  pieceCount: positiveIntegerStringSchema('Piece count'),
  recipientAddress: zod.string().trim().optional(),
})

type UtxoChopperForm = zod.input<typeof utxoChopperFormSchema>
type UtxoChopperTextField = Exclude<keyof UtxoChopperForm, 'fundingOutpoint'>
type UtxoChopperTextFieldProps = Omit<
  ComponentProps<typeof UiTextField>,
  'errorMessage' | 'isInvalid' | 'onChange' | 'value'
> & {
  name: UtxoChopperTextField
}

const utxoChopperFormResolver: Resolver<UtxoChopperForm> = async values => {
  const result = utxoChopperFormSchema.safeParse(values)
  if (result.success) return { values, errors: {} }

  return {
    values: {},
    errors: Object.fromEntries(
      result.error.issues
        .filter(issue => typeof issue.path[0] === 'string')
        .map(issue => [
          issue.path[0],
          {
            type: issue.code,
            message: issue.message,
          },
        ]),
    ),
  }
}

interface BroadcastState {
  busy: boolean
  error: string | null
  result: ChopUtxoResult | null
}

interface WalletUtxosState {
  busy: boolean
  error: string | null
}

const EMPTY_FORM: UtxoChopperForm = {
  fundingOutpoint: '',
  feeOutpoints: '',
  pieceAmount: '250',
  pieceCount: '4',
  recipientAddress: '',
}

const INITIAL_STATE: BroadcastState = {
  busy: false,
  error: null,
  result: null,
}

export default function UtxoChopperDemo() {
  const { lwkNetwork } = useLwk()
  const { connectionStatus, getBlindedWalletUtxos, syncing, syncWallet } = useWallet()
  const { chopUtxo } = useUtxoChopper()
  const { control, handleSubmit, setValue } = useForm<UtxoChopperForm>({
    defaultValues: EMPTY_FORM,
    mode: 'onSubmit',
    resolver: utxoChopperFormResolver,
  })
  const watchedFundingOutpoint = useWatch({ control, name: 'fundingOutpoint' })
  const watchedFeeOutpoints = useWatch({ control, name: 'feeOutpoints' })
  const watchedPieceAmount = useWatch({ control, name: 'pieceAmount' })
  const watchedPieceCount = useWatch({ control, name: 'pieceCount' })
  const [state, setState] = useState<BroadcastState>({ ...INITIAL_STATE })
  const [blindedWalletUtxos, setBlindedWalletUtxos] = useState<WalletTxOut[]>([])
  const [blindedWalletUtxosState, setBlindedWalletUtxosState] = useState<WalletUtxosState>({
    busy: false,
    error: null,
  })
  const [assetFilter, setAssetFilter] = useState<string>('all')
  const { status: txStatus } = useTxStatus(state.result?.txid ?? null)

  const policyAssetId = useMemo(() => lwkNetwork.policyAsset().toString(), [lwkNetwork])
  const assetOptions = useMemo(() => {
    const seen = new Set<string>()
    const options = [{ id: 'all', label: 'All assets' }]
    for (const utxo of blindedWalletUtxos.filter(isConfirmedWalletUtxo)) {
      const assetId = utxo.unblinded().asset().toString()
      if (seen.has(assetId)) continue
      seen.add(assetId)
      options.push({
        id: assetId,
        label: assetId === policyAssetId ? 'L-BTC' : assetId,
      })
    }
    return options
  }, [policyAssetId, blindedWalletUtxos])
  const fundingUtxoOptions = useMemo(() => {
    if (connectionStatus !== 'ready') return []
    return blindedWalletUtxos
      .filter(utxo => {
        if (!isConfirmedWalletUtxo(utxo)) return false
        if (assetFilter === 'all') return true
        return utxo.unblinded().asset().toString() === assetFilter
      })
      .sort((a, b) => {
        const aValue = a.unblinded().value()
        const bValue = b.unblinded().value()
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0
      })
      .map(utxo => {
        const outpoint = utxoToOutpointString(utxo)
        const height = utxo.height()
        const status = height === undefined ? 'mempool' : `height ${height}`
        const assetId = utxo.unblinded().asset().toString()
        const assetLabel = assetId === policyAssetId ? 'L-BTC' : `${assetId.slice(0, 10)}...`
        return {
          id: outpoint,
          label: `${outpoint} | ${utxo.unblinded().value().toString()} units | ${assetLabel} | ${status}`,
        }
      })
  }, [connectionStatus, policyAssetId, assetFilter, blindedWalletUtxos])
  const feeUtxoOptions = useMemo(() => {
    if (connectionStatus !== 'ready') return []
    return blindedWalletUtxos
      .filter(utxo => isConfirmedWalletUtxo(utxo) && isPolicyAssetUtxo(utxo, policyAssetId))
      .sort((a, b) => {
        const aValue = a.unblinded().value()
        const bValue = b.unblinded().value()
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0
      })
      .map(formatCollateralUtxoOption)
  }, [connectionStatus, policyAssetId, blindedWalletUtxos])

  const chopPreview = useMemo(() => {
    const fundingUtxo = blindedWalletUtxos.find(
      utxo => utxoToOutpointString(utxo) === watchedFundingOutpoint,
    )
    const pieceAmount = /^\d+$/.test(watchedPieceAmount) ? BigInt(watchedPieceAmount) : 0n
    const pieceCount = /^\d+$/.test(watchedPieceCount) ? Number.parseInt(watchedPieceCount, 10) : 0
    const requestedAmount = pieceAmount * BigInt(pieceCount)
    const feeOutpointSet = new Set(watchedFeeOutpoints.split(/[\s,]+/).filter(Boolean))
    const feeInputAmount = blindedWalletUtxos
      .filter(utxo => feeOutpointSet.has(utxoToOutpointString(utxo)))
      .filter(utxo => isConfirmedWalletUtxo(utxo) && isPolicyAssetUtxo(utxo, policyAssetId))
      .reduce((sum, utxo) => sum + utxo.unblinded().value(), 0n)

    if (!fundingUtxo) {
      return {
        fundingAmount: 0n,
        feeInputAmount,
        requestedAmount,
        availableAmount: feeInputAmount,
        maxPieces: 0n,
        ok: false,
      }
    }

    const fundingAmount = fundingUtxo.unblinded().value()
    const fundingIsLbtc = isPolicyAssetUtxo(fundingUtxo, policyAssetId)
    const availableAmount = fundingIsLbtc ? fundingAmount + feeInputAmount : fundingAmount
    const maxPieces =
      pieceAmount > 0n
        ? (fundingIsLbtc && availableAmount > 0n ? availableAmount - 1n : availableAmount) /
          pieceAmount
        : 0n
    const ok = fundingIsLbtc
      ? requestedAmount > 0n && requestedAmount < availableAmount
      : requestedAmount > 0n && requestedAmount <= availableAmount && feeInputAmount > 0n

    return {
      fundingAmount,
      feeInputAmount,
      requestedAmount,
      availableAmount,
      maxPieces,
      ok,
    }
  }, [
    watchedFundingOutpoint,
    watchedFeeOutpoints,
    watchedPieceAmount,
    watchedPieceCount,
    policyAssetId,
    blindedWalletUtxos,
  ])

  const refreshWalletUtxos = useCallback(async () => {
    setBlindedWalletUtxosState({ busy: true, error: null })
    try {
      await syncWallet()
      setBlindedWalletUtxos(await getBlindedWalletUtxos())
      setBlindedWalletUtxosState({ busy: false, error: null })
    } catch (err) {
      setBlindedWalletUtxosState({
        busy: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }, [getBlindedWalletUtxos, syncWallet])

  useEffect(() => {
    if (connectionStatus !== 'ready') return

    let cancelled = false
    getBlindedWalletUtxos()
      .then(utxos => {
        if (!cancelled) setBlindedWalletUtxos(utxos)
      })
      .catch(err => {
        if (!cancelled) {
          setBlindedWalletUtxosState({
            busy: false,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [connectionStatus, getBlindedWalletUtxos])

  const onSubmit = async (formValues: UtxoChopperForm) => {
    setState({ busy: true, error: null, result: null })
    try {
      const result = utxoChopperFormSchema.safeParse(formValues)
      if (!result.success) {
        throw new Error(result.error.issues.map(issue => issue.message).join('; '))
      }
      setState({ busy: false, error: null, result: await chopUtxo(result.data) })
      await refreshWalletUtxos()
    } catch (err) {
      setState({
        busy: false,
        error: err instanceof Error ? err.message : String(err),
        result: null,
      })
    }
  }

  const renderTextField = ({ name, ...props }: UtxoChopperTextFieldProps) => (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <UiTextField
          {...props}
          value={field.value ?? ''}
          errorMessage={fieldState.error?.message}
          onBlur={field.onBlur}
          onChange={field.onChange}
        />
      )}
    />
  )

  return (
    <div className='rounded border border-gray-300 bg-white p-4'>
      <div className='font-bold'>UTXO Chopper Demo</div>
      <p className='mt-2 max-w-3xl text-sm text-gray-600'>
        Splits one wallet asset UTXO into many smaller wallet outputs. For non-L-BTC assets, add one
        or more L-BTC fee outpoints.
      </p>

      <div className='mt-4 flex flex-col gap-3'>
        <UiSelect
          label='Asset'
          placeholder='Select asset'
          options={assetOptions}
          value={assetFilter}
          onChange={key => {
            setAssetFilter(key ? String(key) : 'all')
            setValue('fundingOutpoint', '')
          }}
          description='Filters the funding UTXO list by wallet asset'
        />
        <Controller
          control={control}
          name='fundingOutpoint'
          render={({ field, fieldState }) => (
            <UiSelect
              label='Funding asset UTXO'
              placeholder='Select wallet asset UTXO'
              options={fundingUtxoOptions}
              value={field.value || null}
              errorMessage={fieldState.error?.message}
              onChange={key => field.onChange(key ? String(key) : '')}
              description={
                fundingUtxoOptions.length
                  ? `${fundingUtxoOptions.length} wallet asset UTXO(s)`
                  : 'No wallet UTXOs loaded'
              }
            />
          )}
        />
        {renderTextField({
          name: 'feeOutpoints',
          label: 'Fee L-BTC outpoint(s)',
          placeholder: 'txid:vout, txid:vout, ...',
          description: feeUtxoOptions.length
            ? `Optional for L-BTC chops. Available: ${feeUtxoOptions.map(o => o.label).join(' | ')}`
            : 'Required for non-L-BTC chops; no wallet L-BTC UTXOs loaded',
        })}
        {renderTextField({
          name: 'pieceAmount',
          label: 'Piece amount (asset base units)',
          placeholder: '250',
          description: 'Amount for each new output of the selected asset',
        })}
        {renderTextField({
          name: 'pieceCount',
          label: 'Piece count',
          placeholder: '4',
          description: 'How many equal asset outputs to create',
        })}
        {renderTextField({
          name: 'recipientAddress',
          label: 'Recipient address (optional)',
          placeholder: 'Leave blank to use wallet receive address',
          description: 'Use the connected wallet address if you want the pieces available here',
        })}
      </div>

      <div
        className={`mt-3 rounded border p-3 text-xs ${
          chopPreview.ok ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'
        }`}
      >
        <div className='font-semibold'>Chop preview</div>
        <div className='mt-1 grid gap-1 sm:grid-cols-2'>
          <div>Selected funding: {chopPreview.fundingAmount.toString()} units</div>
          <div>Selected fee L-BTC: {chopPreview.feeInputAmount.toString()} sats</div>
          <div>Requested outputs: {chopPreview.requestedAmount.toString()} units</div>
          <div>Max pieces before fees: {chopPreview.maxPieces.toString()}</div>
        </div>
        {!chopPreview.ok ? (
          <p className='mt-2 text-amber-700'>
            Pick a larger funding UTXO, lower piece count/amount, or add fee L-BTC when chopping a
            non-L-BTC asset.
          </p>
        ) : null}
      </div>

      {blindedWalletUtxosState.error ? (
        <p className='mt-2 text-xs text-red-500'>Wallet UTXOs: {blindedWalletUtxosState.error}</p>
      ) : null}

      <div className='mt-4 flex flex-wrap gap-2'>
        <UiButton
          variant='outline'
          isDisabled={connectionStatus !== 'ready' || syncing || blindedWalletUtxosState.busy}
          isPending={syncing || blindedWalletUtxosState.busy}
          loadingText='Refreshing...'
          onPress={refreshWalletUtxos}
        >
          Refresh Wallet UTXOs
        </UiButton>
        <UiButton
          isDisabled={connectionStatus !== 'ready'}
          isPending={state.busy}
          loadingText='Chopping...'
          onPress={() => void handleSubmit(onSubmit)()}
        >
          Chop UTXO
        </UiButton>
      </div>

      {state.error ? <p className='mt-3 text-xs text-red-500'>Chop: {state.error}</p> : null}

      <TxResult
        title='UTXO Chopped'
        txid={state.result?.txid ?? null}
        txStatus={txStatus}
        detail={state.result?.summary}
      />
    </div>
  )
}
