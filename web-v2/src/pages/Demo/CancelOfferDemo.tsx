import type { WalletTxOut } from 'lwk_web'
import { type ComponentProps, useCallback, useEffect, useMemo, useState } from 'react'
import { Controller, type Resolver, useForm } from 'react-hook-form'
import { z as zod } from 'zod'

import { UiButton } from '@/components/ui/UiButton'
import { UiTextField } from '@/components/ui/UiTextField'
import { type CancelOfferResult, useCancelOffer } from '@/hooks/useCancelOffer'
import { useTxStatus } from '@/hooks/useTxStatus'
import { isConfirmedWalletUtxo, isPolicyAssetUtxo } from '@/lwk/utxo'
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
    .transform(value => value.split(/[\s,]+/).filter(Boolean))
    .pipe(zod.array(outpointSchema(label)).min(1, `${label}: at least one outpoint required`))

const cancelOfferFormSchema = zod.object({
  pendingOfferOutpoint: outpointSchema('Pending offer outpoint'),
  lenderNftOutpoint: outpointSchema('Lender NFT outpoint'),
  borrowerNftOutpoint: outpointSchema('Borrower NFT outpoint'),
  collateralRecipientAddress: zod
    .string()
    .trim()
    .min(1, 'Collateral recipient address is required'),
  feeOutpoints: outpointListSchema('Fee L-BTC outpoint'),
})

type CancelOfferForm = zod.input<typeof cancelOfferFormSchema>
type CancelOfferFormField = keyof CancelOfferForm
type CancelOfferTextFieldProps = Omit<
  ComponentProps<typeof UiTextField>,
  'errorMessage' | 'isInvalid' | 'onChange' | 'value'
> & {
  name: CancelOfferFormField
}

const cancelOfferFormResolver: Resolver<CancelOfferForm> = async values => {
  const result = cancelOfferFormSchema.safeParse(values)
  if (result.success) {
    return { values, errors: {} }
  }

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
  result: CancelOfferResult | null
}

interface WalletUtxosState {
  busy: boolean
  error: string | null
}

const EMPTY_FORM: CancelOfferForm = {
  pendingOfferOutpoint: '0d9998a979d7ef048b514d9186e756b869119d234f32824a59f0f2c0d174be34:5',
  lenderNftOutpoint: '0d9998a979d7ef048b514d9186e756b869119d234f32824a59f0f2c0d174be34:3',
  borrowerNftOutpoint: '0d9998a979d7ef048b514d9186e756b869119d234f32824a59f0f2c0d174be34:2',
  collateralRecipientAddress:
    'tlq1qq2xvpcvfup5j8zscjq05u2wxxjcyewk7979f3mmz5l7uw5pqmx6xf5xy50hsn6vhkm5euwt72x878eq6zxx2z58hd7zrsg9qn',
  feeOutpoints: '',
}

const INITIAL_STATE: BroadcastState = {
  busy: false,
  error: null,
  result: null,
}

export default function CancelOfferDemo() {
  const { lwkNetwork } = useLwk()
  const { connectionStatus, getBlindedWalletUtxos, syncing, syncWallet } = useWallet()
  const { cancelOffer } = useCancelOffer()
  const { control, handleSubmit } = useForm<CancelOfferForm>({
    defaultValues: EMPTY_FORM,
    mode: 'onSubmit',
    resolver: cancelOfferFormResolver,
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

  const onSubmit = async (formValues: CancelOfferForm) => {
    setState({ busy: true, error: null, result: null })

    try {
      const result = cancelOfferFormSchema.safeParse(formValues)
      if (!result.success) {
        throw new Error(result.error.issues.map(issue => issue.message).join('; '))
      }

      setState({
        busy: false,
        error: null,
        result: await cancelOffer(result.data),
      })
    } catch (err) {
      setState({
        busy: false,
        error: err instanceof Error ? err.message : String(err),
        result: null,
      })
    }
  }

  const renderTextField = ({ name, ...props }: CancelOfferTextFieldProps) => (
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
      <div className='font-bold'>Cancel Offer Demo</div>
      <p className='mt-2 max-w-3xl text-sm text-gray-600'>
        Loads the exact three cancellation inputs by outpoint, reconstructs the Lending and
        ScriptAuth covenants, burns both offer NFTs, and returns the unlocked collateral to the
        supplied address.
      </p>

      <div className='mt-4 flex flex-col gap-3'>
        {renderTextField({
          name: 'pendingOfferOutpoint',
          label: 'Pending offer Lending outpoint',
          placeholder: 'create-offer-txid:5',
          description: 'CreateOfferDemo places the Lending covenant at vout 5',
        })}
        {renderTextField({
          name: 'lenderNftOutpoint',
          label: 'Lender NFT ScriptAuth outpoint',
          placeholder: 'create-offer-txid:3',
          description: 'CreateOfferDemo places the Lender NFT at vout 3',
        })}
        {renderTextField({
          name: 'borrowerNftOutpoint',
          label: 'Borrower NFT outpoint',
          placeholder: 'create-offer-txid:2',
          description: 'CreateOfferDemo places the wallet-owned Borrower NFT at vout 2',
        })}
        {renderTextField({
          name: 'collateralRecipientAddress',
          label: 'Collateral recipient address',
          placeholder: 'Unconfidential Liquid address',
          description: 'Collateral is returned as an explicit output to preserve covenant ordering',
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
          loadingText='Cancelling offer...'
          onPress={() => void handleSubmit(onSubmit)()}
        >
          Cancel Offer
        </UiButton>
      </div>

      {state.error ? <p className='mt-3 text-xs text-red-500'>Cancel: {state.error}</p> : null}

      <TxResult
        title='Offer Cancelled'
        txid={state.result?.txid ?? null}
        txStatus={txStatus}
        detail={state.result?.summary}
      />
    </div>
  )
}
