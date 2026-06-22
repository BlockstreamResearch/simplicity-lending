import type { WalletTxOut } from 'lwk_web'
import { type ComponentProps, useCallback, useEffect, useMemo, useState } from 'react'
import { Controller, type Resolver, useForm } from 'react-hook-form'
import { z as zod } from 'zod'

import { UiButton } from '@/components/ui/UiButton'
import { UiTextField } from '@/components/ui/UiTextField'
import { type ClaimPrincipalResult, useClaimPrincipal } from '@/hooks/useClaimPrincipal'
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

const claimPrincipalFormSchema = zod.object({
  principalOutpoint: outpointSchema('Principal outpoint'),
  borrowerNftOutpoint: outpointSchema('Borrower NFT outpoint'),
  feeOutpoints: outpointListSchema('Fee L-BTC outpoint'),
  borrowerNftRecipientAddress: zod.string().trim().optional(),
  principalRecipientAddress: zod.string().trim().optional(),
})

type ClaimPrincipalForm = zod.input<typeof claimPrincipalFormSchema>
type ClaimPrincipalTextField = keyof ClaimPrincipalForm
type ClaimPrincipalTextFieldProps = Omit<
  ComponentProps<typeof UiTextField>,
  'errorMessage' | 'isInvalid' | 'onChange' | 'value'
> & {
  name: ClaimPrincipalTextField
}

const claimPrincipalFormResolver: Resolver<ClaimPrincipalForm> = async values => {
  const result = claimPrincipalFormSchema.safeParse(values)
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
  result: ClaimPrincipalResult | null
}

interface WalletUtxosState {
  busy: boolean
  error: string | null
}

const EMPTY_FORM: ClaimPrincipalForm = {
  principalOutpoint: '',
  borrowerNftOutpoint: '',
  feeOutpoints: '',
  borrowerNftRecipientAddress: '',
  principalRecipientAddress: '',
}

const INITIAL_STATE: BroadcastState = {
  busy: false,
  error: null,
  result: null,
}

export default function ClaimPrincipalDemo() {
  const { lwkNetwork } = useLwk()
  const { connectionStatus, getBlindedWalletUtxos, syncing, syncWallet } = useWallet()
  const { claimPrincipal } = useClaimPrincipal()
  const { control, handleSubmit } = useForm<ClaimPrincipalForm>({
    defaultValues: EMPTY_FORM,
    mode: 'onSubmit',
    resolver: claimPrincipalFormResolver,
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

  const onSubmit = async (formValues: ClaimPrincipalForm) => {
    setState({ busy: true, error: null, result: null })
    try {
      const result = claimPrincipalFormSchema.safeParse(formValues)
      if (!result.success) {
        throw new Error(result.error.issues.map(issue => issue.message).join('; '))
      }
      setState({ busy: false, error: null, result: await claimPrincipal(result.data) })
    } catch (err) {
      setState({
        busy: false,
        error: err instanceof Error ? err.message : String(err),
        result: null,
      })
    }
  }

  const renderTextField = ({ name, ...props }: ClaimPrincipalTextFieldProps) => (
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
      <div className='font-bold'>Claim Principal Demo</div>
      <p className='mt-2 max-w-3xl text-sm text-gray-600'>
        Spends the borrower principal UTXO locked in an AssetAuth covenant by presenting the
        Borrower NFT as proof of ownership. The NFT is passed through to the recipient (not burned),
        and the unlocked principal is sent to the specified address. Must be executed before full
        repayment, which burns the Borrower NFT.
      </p>

      <div className='mt-4 flex flex-col gap-3'>
        {renderTextField({
          name: 'principalOutpoint',
          label: 'Borrower principal AssetAuth outpoint',
          placeholder: 'accept-offer-txid:1',
          description: 'AcceptOfferDemo places the borrower principal AssetAuth covenant at vout 1',
        })}
        {renderTextField({
          name: 'borrowerNftOutpoint',
          label: 'Borrower NFT outpoint',
          placeholder: 'create-offer-txid:2',
          description:
            'Wallet-owned Borrower NFT UTXO — originally create-offer-txid:2; authorises the AssetAuth unlock',
        })}
        {renderTextField({
          name: 'borrowerNftRecipientAddress',
          label: 'Borrower NFT recipient address (optional)',
          placeholder: 'Leave blank to use wallet receive address',
          description: 'Where the Borrower NFT is sent after unlocking — keep it for repayment',
        })}
        {renderTextField({
          name: 'principalRecipientAddress',
          label: 'Principal recipient address (optional)',
          placeholder: 'Leave blank to use wallet receive address',
          description: 'Where the unlocked principal amount is sent',
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
          loadingText='Claiming principal...'
          onPress={() => void handleSubmit(onSubmit)()}
        >
          Claim Principal
        </UiButton>
      </div>

      {state.error ? <p className='mt-3 text-xs text-red-500'>Claim: {state.error}</p> : null}

      <TxResult
        title='Principal Claimed'
        txid={state.result?.txid ?? null}
        txStatus={txStatus}
        detail={state.result?.summary}
      />
    </div>
  )
}
