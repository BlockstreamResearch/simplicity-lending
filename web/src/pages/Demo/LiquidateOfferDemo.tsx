import type { WalletTxOut } from '@lilbonekit/lwk-web'
import { type ComponentProps, useCallback, useEffect, useMemo, useState } from 'react'
import { Controller, type Resolver, useForm } from 'react-hook-form'
import { z as zod } from 'zod'

import { broadcastTx } from '@/api/esplora/methods'
import { getDefaultTransactionSteps } from '@/components/TransactionStepper/transactionSteps'
import { UiButton } from '@/components/ui/UiButton'
import { UiTextField } from '@/components/ui/UiTextField'
import { type LiquidateOfferSummary, useLiquidateOffer } from '@/hooks/useLiquidateOffer'
import { useTxStatus } from '@/hooks/useTxStatus'
import { isConfirmedWalletUtxo, isPolicyAssetUtxo } from '@/lwk/utxo'
import { useLwk } from '@/providers/lwk/useLwk'
import { useTxProgress } from '@/providers/txProgress/useTxProgress'
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
    .transform(value => value.split(/[\s,]+/).filter(Boolean))
    .pipe(zod.array(outpointSchema(label)).min(1, `${label}: at least one outpoint required`))

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
  feeOutpoints: outpointListSchema('Fee L-BTC outpoint'),
})

type LiquidateOfferForm = zod.input<typeof liquidateOfferFormSchema>
type LiquidateOfferTextField = keyof LiquidateOfferForm
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
  result: { txid: string; summary: LiquidateOfferSummary } | null
}

interface WalletUtxosState {
  busy: boolean
  error: string | null
}

const EMPTY_FORM: LiquidateOfferForm = {
  activeOfferOutpoint: '',
  createOfferTxid: '',
  lenderNftOutpoint: '',
  feeOutpoints: '',
}

const INITIAL_STATE: BroadcastState = {
  busy: false,
  error: null,
  result: null,
}

export default function LiquidateOfferDemo() {
  const { lwkNetwork } = useLwk()
  const { connectionStatus, getBlindedWalletUtxos, syncing, syncWallet, signPset, signerType } =
    useWallet()
  const { liquidateOffer } = useLiquidateOffer()
  const { start, fail } = useTxProgress()
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
  const { status: txStatus } = useTxStatus(state.result?.txid ?? null)

  const policyAssetId = useMemo(() => lwkNetwork.policyAsset().toString(), [lwkNetwork])
  const feeUtxoOptions = useMemo(() => {
    if (connectionStatus !== 'ready') return []
    return blindedWalletUtxos
      .filter(utxo => isConfirmedWalletUtxo(utxo) && isPolicyAssetUtxo(utxo, policyAssetId))
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
      const advance = await start(getDefaultTransactionSteps(signerType))
      const { pset, finalize } = await liquidateOffer(result.data)
      await advance('signing')
      const signedPset = await signPset(pset)
      await advance('finalizing')
      const { finalizedTx, summary } = finalize(signedPset)
      await advance('broadcasting')
      const txid = await broadcastTx(finalizedTx.toString())

      setState({ busy: false, error: null, result: { txid, summary } })
    } catch (err) {
      fail(err)
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
        {renderTextField({
          name: 'feeOutpoints',
          label: 'Fee L-BTC outpoint(s)',
          placeholder: 'txid:vout, txid:vout, ...',
          description: feeUtxoOptions.length
            ? `Available: ${feeUtxoOptions.map(o => o.label).join(' | ')}`
            : 'No wallet L-BTC UTXOs loaded',
        })}
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
        txStatus={txStatus}
        detail={state.result?.summary}
      />
    </div>
  )
}
