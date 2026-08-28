import type { WalletTxOut } from '@lilbonekit/lwk-web'
import { type ComponentProps, useCallback, useEffect, useMemo, useState } from 'react'
import { Controller, type Resolver, useForm } from 'react-hook-form'
import { z as zod } from 'zod'

import { resolveActiveLenderVaultOutpoint, resolveLenderNftOutpoint } from '@/api/indexer/utils'
import { UiButton } from '@/components/ui/UiButton'
import { UiTextField } from '@/components/ui/UiTextField'
import {
  type LenderVaultWithdrawPartSummary,
  useLenderVaultWithdrawPart,
} from '@/hooks/useLenderVaultWithdrawPart'
import { useStandardTransactionFlow } from '@/hooks/useStandardTransactionFlow'
import { useTxStatus } from '@/hooks/useTxStatus'
import { isConfirmedWalletUtxo, isPolicyAssetUtxo } from '@/lwk/utxo'
import { useLwk } from '@/providers/lwk/useLwk'
import { useWallet } from '@/providers/wallet/useWallet'

import { formatCollateralUtxoOption } from './helpers'
import { OfferIdAutofill } from './OfferIdAutofill'
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

const lenderVaultWithdrawPartFormSchema = zod.object({
  lenderVaultOutpoint: outpointSchema('Lender vault outpoint'),
  lenderNftOutpoint: outpointSchema('Lender NFT outpoint'),
  createOfferTxid: txidSchema('Create-offer txid'),
  alreadySupplied: zod.string().trim().regex(/^\d+$/, 'Must be a whole number'),
  amountToWithdraw: zod
    .string()
    .trim()
    .regex(/^\d+$/, 'Amount to withdraw must be a whole number')
    .refine(value => BigInt(value) > 0n, 'Amount to withdraw must be greater than zero'),
  feeOutpoints: outpointListSchema('Fee L-BTC outpoint'),
  principalRecipientAddress: zod.string().trim().optional(),
  lenderNftRecipientAddress: zod.string().trim().optional(),
})

type LenderVaultWithdrawPartForm = zod.input<typeof lenderVaultWithdrawPartFormSchema>
type LenderVaultWithdrawPartTextField = keyof LenderVaultWithdrawPartForm
type LenderVaultWithdrawPartTextFieldProps = Omit<
  ComponentProps<typeof UiTextField>,
  'errorMessage' | 'isInvalid' | 'onChange' | 'value'
> & {
  name: LenderVaultWithdrawPartTextField
}

const lenderVaultWithdrawPartFormResolver: Resolver<LenderVaultWithdrawPartForm> = async values => {
  const result = lenderVaultWithdrawPartFormSchema.safeParse(values)
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
  result: { txid: string; summary: LenderVaultWithdrawPartSummary } | null
}

interface WalletUtxosState {
  busy: boolean
  error: string | null
}

const EMPTY_FORM: LenderVaultWithdrawPartForm = {
  lenderVaultOutpoint: '',
  lenderNftOutpoint: '',
  createOfferTxid: '',
  alreadySupplied: '',
  amountToWithdraw: '',
  feeOutpoints: '',
  principalRecipientAddress: '',
  lenderNftRecipientAddress: '',
}

const INITIAL_STATE: BroadcastState = {
  busy: false,
  error: null,
  result: null,
}

export default function LenderVaultWithdrawPartDemo() {
  const { lwkNetwork } = useLwk()
  const { connectionStatus, getBlindedWalletUtxos, syncing, syncWallet } = useWallet()
  const { withdrawLenderVaultPart } = useLenderVaultWithdrawPart()
  const runStandardTransactionFlow = useStandardTransactionFlow()
  const { control, handleSubmit, setValue } = useForm<LenderVaultWithdrawPartForm>({
    defaultValues: EMPTY_FORM,
    mode: 'onSubmit',
    resolver: lenderVaultWithdrawPartFormResolver,
  })
  const [state, setState] = useState<BroadcastState>({ ...INITIAL_STATE })
  const [foundVault, setFoundVault] = useState<string | null>(null)
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

  const onSubmit = async (formValues: LenderVaultWithdrawPartForm) => {
    setState({ busy: true, error: null, result: null })
    try {
      const result = lenderVaultWithdrawPartFormSchema.safeParse(formValues)
      if (!result.success) {
        throw new Error(result.error.issues.map(issue => issue.message).join('; '))
      }
      const { txid, summary } = await runStandardTransactionFlow(() =>
        withdrawLenderVaultPart(result.data),
      )

      setState({ busy: false, error: null, result: { txid, summary } })
    } catch (err) {
      setState({
        busy: false,
        error: err instanceof Error ? err.message : String(err),
        result: null,
      })
    }
  }

  const renderTextField = ({ name, ...props }: LenderVaultWithdrawPartTextFieldProps) => (
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
      <div className='font-bold'>Lender Vault Partial Withdraw Demo</div>
      <p className='mt-2 max-w-3xl text-sm text-gray-600'>
        Spends an active (not yet finalized) lender vault UTXO, withdrawing part of the
        already-supplied principal without waiting for the offer to fully repay. The Lender NFT is
        passed through (not burned) and the vault continues with the reduced balance.
      </p>

      <OfferIdAutofill
        onResolve={offer => {
          const lenderVaultOutpoint = resolveActiveLenderVaultOutpoint(offer)
          if (!lenderVaultOutpoint) throw new Error('Active lender vault UTXO not found')
          const lenderNftOutpoint = resolveLenderNftOutpoint(offer)
          if (!lenderNftOutpoint) throw new Error('Lender NFT UTXO not found')
          const vault = offer.vaults.find(v => v.vault_type === 'lender' && !v.is_finalized)
          if (!vault) throw new Error('Active lender vault not found')

          setValue('lenderVaultOutpoint', lenderVaultOutpoint)
          setValue('lenderNftOutpoint', lenderNftOutpoint)
          setValue('createOfferTxid', offer.created_at_txid)
          setValue('alreadySupplied', vault.already_supplied.toString())
          setFoundVault(
            `balance ${vault.amount.toString()}, already supplied ${vault.already_supplied.toString()}`,
          )
        }}
      />
      {foundVault ? <p className='mt-2 text-xs text-gray-600'>Found: {foundVault}</p> : null}

      <div className='mt-4 flex flex-col gap-3'>
        {renderTextField({
          name: 'lenderVaultOutpoint',
          label: 'Active lender vault AssetAuthVault outpoint',
          placeholder: 'txid:vout',
          description: 'The active (not finalized) lender vault UTXO',
        })}
        {renderTextField({
          name: 'lenderNftOutpoint',
          label: 'Lender NFT outpoint',
          placeholder: 'txid:vout',
          description: 'Wallet-owned Lender NFT UTXO — passed through, not burned',
        })}
        {renderTextField({
          name: 'createOfferTxid',
          label: 'Create-offer txid',
          placeholder: '64 hex chars',
          description: 'Used to recover offer parameters and the vault supply goal',
        })}
        {renderTextField({
          name: 'alreadySupplied',
          label: 'Already supplied (vault state)',
          placeholder: 'e.g. 900',
          description: "The vault's current already_supplied accounting value from the indexer",
        })}
        {renderTextField({
          name: 'amountToWithdraw',
          label: 'Amount to withdraw',
          placeholder: 'e.g. 100',
          description: 'Must be less than the vault balance',
        })}
        {renderTextField({
          name: 'principalRecipientAddress',
          label: 'Principal recipient address (optional)',
          placeholder: 'Leave blank to use wallet receive address',
          description: 'Where the withdrawn principal is sent',
        })}
        {renderTextField({
          name: 'lenderNftRecipientAddress',
          label: 'Lender NFT recipient address (optional)',
          placeholder: 'Leave blank to use wallet receive address',
          description: 'Where the (unburned) Lender NFT is returned',
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
          loadingText='Withdrawing...'
          onPress={() => void handleSubmit(onSubmit)()}
        >
          Withdraw Part
        </UiButton>
      </div>

      {state.error ? <p className='mt-3 text-xs text-red-500'>Withdraw: {state.error}</p> : null}

      <TxResult
        title='Lender Vault Partially Withdrawn'
        txid={state.result?.txid ?? null}
        txStatus={txStatus}
        detail={state.result?.summary}
      />
    </div>
  )
}
