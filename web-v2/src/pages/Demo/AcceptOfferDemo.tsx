import type { WalletTxOut } from 'lwk_web'
import { type ComponentProps, useCallback, useEffect, useMemo, useState } from 'react'
import { Controller, type Resolver, useForm } from 'react-hook-form'
import { z as zod } from 'zod'

import { UiButton } from '@/components/ui/UiButton'
import { UiTextField } from '@/components/ui/UiTextField'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { type AcceptOfferResult, useAcceptOffer } from '@/hooks/useAcceptOffer'
import { useTxStatus } from '@/hooks/useTxStatus'
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
    .transform(value => value.split(/[\s,]+/).filter(Boolean))
    .pipe(zod.array(outpointSchema(label)).min(1, `${label}: at least one outpoint required`))

const acceptOfferFormSchema = zod.object({
  pendingOfferOutpoint: outpointSchema('Pending offer outpoint'),
  lenderNftOutpoint: outpointSchema('Lender NFT outpoint'),
  borrowerNftReferenceOutpoint: outpointSchema('Borrower NFT reference outpoint'),
  principalOutpoints: outpointListSchema('Principal outpoint'),
  feeOutpoints: outpointListSchema('Fee L-BTC outpoint'),
})

type AcceptOfferForm = zod.input<typeof acceptOfferFormSchema>
type AcceptOfferTextField = keyof AcceptOfferForm
type AcceptOfferTextFieldProps = Omit<
  ComponentProps<typeof UiTextField>,
  'errorMessage' | 'isInvalid' | 'onChange' | 'value'
> & {
  name: AcceptOfferTextField
}

const acceptOfferFormResolver: Resolver<AcceptOfferForm> = async values => {
  const result = acceptOfferFormSchema.safeParse(values)
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
  result: AcceptOfferResult | null
}

interface WalletUtxosState {
  busy: boolean
  error: string | null
}

const EMPTY_FORM: AcceptOfferForm = {
  pendingOfferOutpoint: '9e4dc019c8402a361adbd40ed0266054c1750410fc9d9715acf1072822fe51e3:5',
  lenderNftOutpoint: '9e4dc019c8402a361adbd40ed0266054c1750410fc9d9715acf1072822fe51e3:3',
  borrowerNftReferenceOutpoint:
    '9e4dc019c8402a361adbd40ed0266054c1750410fc9d9715acf1072822fe51e3:2',
  principalOutpoints: '',
  feeOutpoints: '',
}

const INITIAL_STATE: BroadcastState = {
  busy: false,
  error: null,
  result: null,
}

export default function AcceptOfferDemo() {
  const { lwkNetwork } = useLwk()
  const { connectionStatus, getBlindedWalletUtxos, syncing, syncWallet } = useWallet()
  const { acceptOffer } = useAcceptOffer()
  const { control, handleSubmit } = useForm<AcceptOfferForm>({
    defaultValues: EMPTY_FORM,
    mode: 'onSubmit',
    resolver: acceptOfferFormResolver,
  })
  const [state, setState] = useState<BroadcastState>({ ...INITIAL_STATE })
  const [blindedWalletUtxos, setBlindedWalletUtxos] = useState<WalletTxOut[]>([])
  const [blindedWalletUtxosState, setBlindedWalletUtxosState] = useState<WalletUtxosState>({
    busy: false,
    error: null,
  })
  const txStatus = useTxStatus(state.result?.txid ?? null)

  const policyAssetId = useMemo(() => lwkNetwork.policyAsset().toString(), [lwkNetwork])
  const principalAsset = NETWORK_CONFIG.principalAsset
  const principalUtxoOptions = useMemo(() => {
    if (connectionStatus !== 'ready') return []
    return blindedWalletUtxos
      .filter(
        utxo =>
          isConfirmedWalletUtxo(utxo) && utxo.unblinded().asset().toString() === principalAsset.id,
      )
      .map(utxo => {
        const outpoint = utxoToOutpointString(utxo)
        const unblinded = utxo.unblinded()
        const height = utxo.height()
        const status = height === undefined ? 'mempool' : `height ${height}`
        return {
          id: outpoint,
          label: `${outpoint} | ${unblinded.value().toString()} units | asset ${unblinded.asset().toString()} | ${status}`,
        }
      })
  }, [connectionStatus, principalAsset.id, blindedWalletUtxos])
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

  const onSubmit = async (formValues: AcceptOfferForm) => {
    setState({ busy: true, error: null, result: null })

    try {
      const result = acceptOfferFormSchema.safeParse(formValues)
      if (!result.success) {
        throw new Error(result.error.issues.map(issue => issue.message).join('; '))
      }

      setState({
        busy: false,
        error: null,
        result: await acceptOffer(result.data),
      })
    } catch (err) {
      setState({
        busy: false,
        error: err instanceof Error ? err.message : String(err),
        result: null,
      })
    }
  }

  const renderTextField = ({ name, ...props }: AcceptOfferTextFieldProps) => (
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
      <div className='font-bold'>Accept Offer Demo</div>
      <p className='mt-2 max-w-3xl text-sm text-gray-600'>
        Reconstructs the pending Lending offer, unlocks its Lender NFT through ScriptAuth, selects
        enough principal asset from the connected wallet, and creates the active offer, borrower
        AssetAuth principal output, and lender-owned Lending NFT.
      </p>

      <div className='mt-4 flex flex-col gap-3'>
        {renderTextField({
          name: 'pendingOfferOutpoint',
          label: 'Pending offer Lending outpoint',
          placeholder: 'create-offer-txid:5',
          description: 'CreateOfferDemo places the pending Lending covenant at vout 5',
        })}
        {renderTextField({
          name: 'lenderNftOutpoint',
          label: 'Lender NFT ScriptAuth outpoint',
          placeholder: 'create-offer-txid:3',
          description: 'CreateOfferDemo places the Lender NFT at vout 3',
        })}
        {renderTextField({
          name: 'borrowerNftReferenceOutpoint',
          label: 'Borrower NFT reference outpoint',
          placeholder: 'create-offer-txid:2',
          description:
            'CreateOfferDemo places the Borrower NFT at vout 2; used only to recover its asset id',
        })}
        {renderTextField({
          name: 'principalOutpoints',
          label: 'Principal asset outpoint(s)',
          placeholder: 'txid:vout, txid:vout, ...',
          description:
            `Filtered by ${principalAsset.symbol} asset: ${principalAsset.id}. ` +
            (principalUtxoOptions.length
              ? `Available: ${principalUtxoOptions.map(o => o.label).join(' | ')}`
              : 'No matching wallet UTXOs loaded'),
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
          Refresh Wallet UTXOs
        </UiButton>
        <UiButton
          isDisabled={connectionStatus !== 'ready'}
          isPending={state.busy}
          loadingText='Accepting offer...'
          onPress={() => void handleSubmit(onSubmit)()}
        >
          Accept Offer
        </UiButton>
      </div>

      {state.error ? <p className='mt-3 text-xs text-red-500'>Accept: {state.error}</p> : null}

      <TxResult
        title='Offer Accepted'
        txid={state.result?.txid ?? null}
        txStatus={txStatus}
        detail={state.result?.summary}
      />
    </div>
  )
}
