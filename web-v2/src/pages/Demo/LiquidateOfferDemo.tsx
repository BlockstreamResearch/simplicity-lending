import type { WalletTxOut } from 'lwk_web'
import { type ComponentProps, useCallback, useEffect, useMemo, useState } from 'react'
import { Controller, type Resolver, useForm } from 'react-hook-form'
import { z as zod } from 'zod'

import { UiButton } from '@/components/ui/UiButton'
import { UiSelect } from '@/components/ui/UiSelect'
import { UiTextField } from '@/components/ui/UiTextField'
import { type LiquidateOfferResult, useLiquidateOffer } from '@/hooks/useLiquidateOffer'
import { isPolicyAssetUtxo } from '@/lwk/utxo'
import { useLwk } from '@/providers/lwk/useLwk'
import { useWallet } from '@/providers/wallet/useWallet'

import { formatCollateralUtxoOption, useTxConfirmations } from './helpers'
import { TxResult } from './TxResult'

const outpointSchema = (label: string) =>
  zod
    .string()
    .trim()
    .regex(/^[0-9a-fA-F]{64}:\d+$/, `${label} must have txid:vout format`)
    .transform(value => value.toLowerCase())

const txidSchema = (label: string) =>
  zod
    .string()
    .trim()
    .regex(/^[0-9a-fA-F]{64}$/, `${label} must be a 64-char hex txid`)
    .transform(value => value.toLowerCase())

const liquidateOfferFormSchema = zod.object({
  activeOfferOutpoint: outpointSchema('Active offer outpoint'),
  createOfferTxid: txidSchema('Create-offer txid'),
  lenderNftOutpoint: outpointSchema('Lender NFT outpoint'),
  feeOutpoint: outpointSchema('Fee L-BTC outpoint'),
})

type LiquidateOfferForm = zod.input<typeof liquidateOfferFormSchema>
type LiquidateOfferTextField = Exclude<keyof LiquidateOfferForm, 'feeOutpoint'>
type LiquidateOfferTextFieldProps = Omit<
  ComponentProps<typeof UiTextField>,
  'errorMessage' | 'isInvalid' | 'onChange' | 'value'
> & {
  name: LiquidateOfferTextField
}

const liquidateOfferFormResolver: Resolver<LiquidateOfferForm> = async values => {
  const result = liquidateOfferFormSchema.safeParse(values)
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
  result: LiquidateOfferResult | null
}

interface WalletUtxosState {
  busy: boolean
  error: string | null
}

const EMPTY_FORM: LiquidateOfferForm = {
  activeOfferOutpoint: '',
  createOfferTxid: '',
  lenderNftOutpoint: '',
  feeOutpoint: '',
}

const INITIAL_STATE: BroadcastState = {
  busy: false,
  error: null,
  result: null,
}

export default function LiquidateOfferDemo() {
  const { lwkNetwork } = useLwk()
  const { connectionStatus, getBlindedWalletUtxos, syncing, syncWallet } = useWallet()
  const { liquidateOffer } = useLiquidateOffer()
  const { control, handleSubmit } = useForm<LiquidateOfferForm>({
    defaultValues: EMPTY_FORM,
    mode: 'onSubmit',
    resolver: liquidateOfferFormResolver,
  })
  const [state, setState] = useState<BroadcastState>({ ...INITIAL_STATE })
  const [blindedWalletUtxos, setBlindedWalletUtxos] = useState<WalletTxOut[]>([])
  const [blindedWalletUtxosState, setBlindedWalletUtxosState] = useState<WalletUtxosState>({
    busy: false,
    error: null,
  })
  const confirmations = useTxConfirmations(state.result?.txid ?? null)

  const policyAssetId = useMemo(() => lwkNetwork.policyAsset().toString(), [lwkNetwork])
  const feeUtxoOptions = useMemo(() => {
    if (connectionStatus !== 'ready') return []
    return blindedWalletUtxos
      .filter(utxo => isPolicyAssetUtxo(utxo, policyAssetId))
      .map(formatCollateralUtxoOption)
  }, [connectionStatus, policyAssetId, blindedWalletUtxos])

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

  const onSubmit = async (formValues: LiquidateOfferForm) => {
    setState({ busy: true, error: null, result: null })
    try {
      const result = liquidateOfferFormSchema.safeParse(formValues)
      if (!result.success) {
        throw new Error(result.error.issues.map(issue => issue.message).join('; '))
      }
      setState({ busy: false, error: null, result: await liquidateOffer(result.data) })
    } catch (err) {
      setState({
        busy: false,
        error: err instanceof Error ? err.message : String(err),
        result: null,
      })
    }
  }

  const renderTextField = ({ name, ...props }: LiquidateOfferTextFieldProps) => (
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
      <div className='font-bold'>Liquidate Offer Demo</div>
      <p className='mt-2 max-w-3xl text-sm text-gray-600'>
        Spends the active Lending covenant after loan expiration. Burns the Lender NFT and returns
        the unlocked collateral to the connected wallet. Transaction locktime is set automatically
        from the offer metadata.
      </p>

      <div className='mt-4 flex flex-col gap-3'>
        {renderTextField({
          name: 'activeOfferOutpoint',
          label: 'Active offer Lending outpoint',
          placeholder: 'accept-offer-txid:0',
          description: 'AcceptOfferDemo places the active Lending covenant at vout 0',
        })}
        {renderTextField({
          name: 'createOfferTxid',
          label: 'Create-offer txid',
          placeholder: '64 hex chars',
          description:
            'Original create-offer txid — used to recover offer parameters from the OP_RETURN metadata and borrower NFT asset id (vout 2)',
        })}
        {renderTextField({
          name: 'lenderNftOutpoint',
          label: 'Lender NFT outpoint',
          placeholder: 'accept-offer-txid:2 or current location',
          description: 'Wallet-owned Lender NFT UTXO received during offer acceptance',
        })}
        <Controller
          control={control}
          name='feeOutpoint'
          render={({ field, fieldState }) => (
            <UiSelect
              label='Fee L-BTC outpoint'
              placeholder='Select wallet L-BTC UTXO'
              options={feeUtxoOptions}
              selectedKey={field.value || null}
              errorMessage={fieldState.error?.message}
              onSelectionChange={key => field.onChange(key ? String(key) : '')}
              description={
                feeUtxoOptions.length
                  ? `${feeUtxoOptions.length} wallet L-BTC UTXO(s)`
                  : 'No wallet L-BTC UTXOs loaded'
              }
            />
          )}
        />
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
          Refresh L-BTC UTXOs
        </UiButton>
        <UiButton
          isDisabled={connectionStatus !== 'ready'}
          isPending={state.busy}
          loadingText='Liquidating...'
          onPress={() => void handleSubmit(onSubmit)()}
        >
          Liquidate Offer
        </UiButton>
      </div>

      {state.error ? <p className='mt-3 text-xs text-red-500'>Liquidate: {state.error}</p> : null}

      <TxResult
        title='Offer Liquidated'
        txid={state.result?.txid ?? null}
        confirmations={confirmations}
        detail={state.result?.summary}
      />
    </div>
  )
}
