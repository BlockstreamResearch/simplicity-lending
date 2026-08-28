import type { WalletTxOut } from '@lilbonekit/lwk-web'
import { type ComponentProps, useCallback, useEffect, useMemo, useState } from 'react'
import { Controller, type Resolver, useForm } from 'react-hook-form'
import { z as zod } from 'zod'

import { resolveActiveProtocolFeeVaultOutpoint } from '@/api/indexer/utils'
import { UiButton } from '@/components/ui/UiButton'
import { UiTextField } from '@/components/ui/UiTextField'
import { NETWORK_CONFIG } from '@/constants/network-config'
import {
  type ProtocolFeeVaultWithdrawPartSummary,
  useProtocolFeeVaultWithdrawPart,
} from '@/hooks/useProtocolFeeVaultWithdrawPart'
import { useStandardTransactionFlow } from '@/hooks/useStandardTransactionFlow'
import { useTxStatus } from '@/hooks/useTxStatus'
import { isConfirmedWalletUtxo, isPolicyAssetUtxo, utxoToOutpointString } from '@/lwk/utxo'
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

const protocolFeeVaultWithdrawPartFormSchema = zod.object({
  protocolFeeVaultOutpoint: outpointSchema('Protocol fee vault outpoint'),
  keeperOutpoint: outpointSchema('Protocol fee keeper outpoint'),
  createOfferTxid: txidSchema('Create-offer txid'),
  alreadySupplied: zod.string().trim().regex(/^\d+$/, 'Must be a whole number'),
  amountToWithdraw: zod
    .string()
    .trim()
    .regex(/^\d+$/, 'Amount to withdraw must be a whole number')
    .refine(value => BigInt(value) > 0n, 'Amount to withdraw must be greater than zero'),
  feeOutpoints: outpointListSchema('Fee L-BTC outpoint'),
  keeperRecipientAddress: zod.string().trim().optional(),
  principalRecipientAddress: zod.string().trim().optional(),
})

type ProtocolFeeVaultWithdrawPartForm = zod.input<typeof protocolFeeVaultWithdrawPartFormSchema>
type ProtocolFeeVaultWithdrawPartTextField = keyof ProtocolFeeVaultWithdrawPartForm
type ProtocolFeeVaultWithdrawPartTextFieldProps = Omit<
  ComponentProps<typeof UiTextField>,
  'errorMessage' | 'isInvalid' | 'onChange' | 'value'
> & {
  name: ProtocolFeeVaultWithdrawPartTextField
}

const protocolFeeVaultWithdrawPartFormResolver: Resolver<
  ProtocolFeeVaultWithdrawPartForm
> = async values => {
  const result = protocolFeeVaultWithdrawPartFormSchema.safeParse(values)
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
  result: { txid: string; summary: ProtocolFeeVaultWithdrawPartSummary } | null
}

interface WalletUtxosState {
  busy: boolean
  error: string | null
}

const EMPTY_FORM: ProtocolFeeVaultWithdrawPartForm = {
  protocolFeeVaultOutpoint: '',
  keeperOutpoint: '',
  createOfferTxid: '',
  alreadySupplied: '',
  amountToWithdraw: '',
  feeOutpoints: '',
  keeperRecipientAddress: '',
  principalRecipientAddress: '',
}

const INITIAL_STATE: BroadcastState = {
  busy: false,
  error: null,
  result: null,
}

export default function ProtocolFeeVaultWithdrawPartDemo() {
  const { lwkNetwork } = useLwk()
  const { connectionStatus, getBlindedWalletUtxos, syncing, syncWallet } = useWallet()
  const { withdrawProtocolFeeVaultPart } = useProtocolFeeVaultWithdrawPart()
  const runStandardTransactionFlow = useStandardTransactionFlow()
  const { control, handleSubmit, setValue } = useForm<ProtocolFeeVaultWithdrawPartForm>({
    defaultValues: EMPTY_FORM,
    mode: 'onSubmit',
    resolver: protocolFeeVaultWithdrawPartFormResolver,
  })
  const [state, setState] = useState<BroadcastState>({ ...INITIAL_STATE })
  const [foundVault, setFoundVault] = useState<string | null>(null)
  const [walletUtxos, setWalletUtxos] = useState<WalletTxOut[]>([])
  const [walletUtxosState, setWalletUtxosState] = useState<WalletUtxosState>({
    busy: false,
    error: null,
  })
  const { status: txStatus } = useTxStatus(state.result?.txid ?? null)

  const policyAssetId = useMemo(() => lwkNetwork.policyAsset().toString(), [lwkNetwork])
  const keeperAsset = NETWORK_CONFIG.protocolFeeAsset

  const keeperUtxoOptions = useMemo(() => {
    if (connectionStatus !== 'ready') return []
    return walletUtxos
      .filter(
        utxo =>
          isConfirmedWalletUtxo(utxo) && utxo.unblinded().asset().toString() === keeperAsset.id,
      )
      .map(utxo => {
        const outpoint = utxoToOutpointString(utxo)
        const unblinded = utxo.unblinded()
        return {
          id: outpoint,
          label: `${outpoint} | ${unblinded.value().toString()} units`,
        }
      })
  }, [connectionStatus, keeperAsset.id, walletUtxos])
  const feeUtxoOptions = useMemo(() => {
    if (connectionStatus !== 'ready') return []
    return walletUtxos
      .filter(utxo => isConfirmedWalletUtxo(utxo) && isPolicyAssetUtxo(utxo, policyAssetId))
      .map(formatCollateralUtxoOption)
  }, [connectionStatus, policyAssetId, walletUtxos])

  const refreshWalletUtxos = useCallback(async () => {
    setWalletUtxosState({ busy: true, error: null })
    try {
      await syncWallet()
      setWalletUtxos(await getBlindedWalletUtxos())
      setWalletUtxosState({ busy: false, error: null })
    } catch (err) {
      setWalletUtxosState({
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
        if (!cancelled) setWalletUtxos(utxos)
      })
      .catch(err => {
        if (!cancelled) {
          setWalletUtxosState({
            busy: false,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [connectionStatus, getBlindedWalletUtxos])

  const onSubmit = async (formValues: ProtocolFeeVaultWithdrawPartForm) => {
    setState({ busy: true, error: null, result: null })
    try {
      const result = protocolFeeVaultWithdrawPartFormSchema.safeParse(formValues)
      if (!result.success) {
        throw new Error(result.error.issues.map(issue => issue.message).join('; '))
      }
      const { txid, summary } = await runStandardTransactionFlow(() =>
        withdrawProtocolFeeVaultPart(result.data),
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

  const renderTextField = ({ name, ...props }: ProtocolFeeVaultWithdrawPartTextFieldProps) => (
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
      <div className='font-bold'>Protocol Fee Vault Partial Withdraw Demo</div>
      <p className='mt-2 max-w-3xl text-sm text-gray-600'>
        Spends an active (not yet finalized) protocol-fee vault UTXO, withdrawing part of the
        already-supplied fee. Same network-wide keeper credential as the final claim demo — not a
        per-offer NFT, picked from the connected wallet.
      </p>

      <OfferIdAutofill
        onResolve={offer => {
          const protocolFeeVaultOutpoint = resolveActiveProtocolFeeVaultOutpoint(offer)
          if (!protocolFeeVaultOutpoint) throw new Error('Active protocol-fee vault UTXO not found')
          const vault = offer.vaults.find(v => v.vault_type === 'protocol_fee' && !v.is_finalized)
          if (!vault) throw new Error('Active protocol-fee vault not found')

          setValue('protocolFeeVaultOutpoint', protocolFeeVaultOutpoint)
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
          name: 'protocolFeeVaultOutpoint',
          label: 'Active protocol-fee vault AssetAuthVault outpoint',
          placeholder: 'txid:vout',
          description: 'The active (not finalized) protocol-fee vault UTXO',
        })}
        {renderTextField({
          name: 'keeperOutpoint',
          label: 'Protocol fee keeper outpoint (wallet)',
          placeholder: 'txid:vout',
          description:
            `Filtered by ${keeperAsset.symbol} asset: ${keeperAsset.id}. ` +
            (keeperUtxoOptions.length
              ? `Available: ${keeperUtxoOptions.map(o => o.label).join(' | ')}`
              : 'No matching wallet UTXOs loaded'),
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
          placeholder: 'e.g. 60',
          description: "The vault's current already_supplied accounting value from the indexer",
        })}
        {renderTextField({
          name: 'amountToWithdraw',
          label: 'Amount to withdraw',
          placeholder: 'e.g. 20',
          description: 'Must be less than the vault balance',
        })}
        {renderTextField({
          name: 'keeperRecipientAddress',
          label: 'Keeper recipient address (optional)',
          placeholder: 'Leave blank to use wallet receive address',
          description: 'Where the passed-through keeper credential is sent back',
        })}
        {renderTextField({
          name: 'principalRecipientAddress',
          label: 'Principal recipient address (optional)',
          placeholder: 'Leave blank to use wallet receive address',
          description: 'Where the withdrawn fee amount is sent',
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

      {walletUtxosState.error ? (
        <p className='mt-2 text-xs text-red-500'>Wallet UTXOs: {walletUtxosState.error}</p>
      ) : null}

      <div className='mt-4 flex flex-wrap gap-2'>
        <UiButton
          variant='outline'
          isDisabled={connectionStatus !== 'ready' || syncing || walletUtxosState.busy}
          isPending={syncing || walletUtxosState.busy}
          loadingText='Refreshing...'
          onPress={refreshWalletUtxos}
        >
          Refresh Wallet UTXOs
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
        title='Protocol Fee Vault Partially Withdrawn'
        txid={state.result?.txid ?? null}
        txStatus={txStatus}
        detail={state.result?.summary}
      />
    </div>
  )
}
