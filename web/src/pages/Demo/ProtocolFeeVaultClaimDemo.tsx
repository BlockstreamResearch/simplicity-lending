import type { WalletTxOut } from '@lilbonekit/lwk-web'
import { type ComponentProps, useCallback, useEffect, useMemo, useState } from 'react'
import { Controller, type Resolver, useForm } from 'react-hook-form'
import { z as zod } from 'zod'

import { resolveProtocolFeeVaultOutpoint } from '@/api/indexer/utils'
import { UiButton } from '@/components/ui/UiButton'
import { UiTextField } from '@/components/ui/UiTextField'
import { NETWORK_CONFIG } from '@/constants/network-config'
import {
  type ProtocolFeeVaultClaimSummary,
  useProtocolFeeVaultClaim,
} from '@/hooks/useProtocolFeeVaultClaim'
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

const protocolFeeVaultClaimFormSchema = zod.object({
  protocolFeeVaultOutpoint: outpointSchema('Protocol fee vault outpoint'),
  keeperOutpoint: outpointSchema('Protocol fee keeper outpoint'),
  createOfferTxid: txidSchema('Create-offer txid'),
  feeOutpoints: outpointListSchema('Fee L-BTC outpoint'),
  keeperRecipientAddress: zod.string().trim().optional(),
  principalRecipientAddress: zod.string().trim().optional(),
})

type ProtocolFeeVaultClaimForm = zod.input<typeof protocolFeeVaultClaimFormSchema>
type ProtocolFeeVaultClaimTextField = keyof ProtocolFeeVaultClaimForm
type ProtocolFeeVaultClaimTextFieldProps = Omit<
  ComponentProps<typeof UiTextField>,
  'errorMessage' | 'isInvalid' | 'onChange' | 'value'
> & {
  name: ProtocolFeeVaultClaimTextField
}

const protocolFeeVaultClaimFormResolver: Resolver<ProtocolFeeVaultClaimForm> = async values => {
  const result = protocolFeeVaultClaimFormSchema.safeParse(values)
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
  result: { txid: string; summary: ProtocolFeeVaultClaimSummary } | null
}

interface WalletUtxosState {
  busy: boolean
  error: string | null
}

const EMPTY_FORM: ProtocolFeeVaultClaimForm = {
  protocolFeeVaultOutpoint: '',
  keeperOutpoint: '',
  createOfferTxid: '',
  feeOutpoints: '',
  keeperRecipientAddress: '',
  principalRecipientAddress: '',
}

const INITIAL_STATE: BroadcastState = {
  busy: false,
  error: null,
  result: null,
}

export default function ProtocolFeeVaultClaimDemo() {
  const { lwkNetwork } = useLwk()
  const { connectionStatus, getBlindedWalletUtxos, syncing, syncWallet } = useWallet()
  const { claimProtocolFeeVault } = useProtocolFeeVaultClaim()
  const runStandardTransactionFlow = useStandardTransactionFlow()
  const { control, handleSubmit, setValue } = useForm<ProtocolFeeVaultClaimForm>({
    defaultValues: EMPTY_FORM,
    mode: 'onSubmit',
    resolver: protocolFeeVaultClaimFormResolver,
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

  // The protocol-fee "keeper" isn't a per-offer NFT — it's just NETWORK_CONFIG.protocolFeeAsset,
  // a network-wide credential (any wallet UTXO of it, passed through unburned). Not resolvable
  // from an offer id — pick it from the connected wallet like a normal fee/principal outpoint.
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
        const blindedTag = unblinded.isExplicit() ? 'explicit' : 'blinded'
        return {
          id: outpoint,
          label: `${outpoint} | ${unblinded.value().toString()} units | ${blindedTag}`,
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

  const onSubmit = async (formValues: ProtocolFeeVaultClaimForm) => {
    setState({ busy: true, error: null, result: null })
    try {
      const result = protocolFeeVaultClaimFormSchema.safeParse(formValues)
      if (!result.success) {
        throw new Error(result.error.issues.map(issue => issue.message).join('; '))
      }
      const { txid, summary } = await runStandardTransactionFlow(() =>
        claimProtocolFeeVault(result.data),
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

  const renderTextField = ({ name, ...props }: ProtocolFeeVaultClaimTextFieldProps) => (
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
      <div className='font-bold'>Protocol Fee Vault Final Claim Demo</div>
      <p className='mt-2 max-w-3xl text-sm text-gray-600'>
        Spends the finalized protocol-fee vault UTXO. Unlike the lender vault, the keeper credential
        is not burned — it&apos;s NETWORK_CONFIG.protocolFeeAsset, a network-wide credential passed
        through unchanged, not a per-offer NFT.
      </p>

      <OfferIdAutofill
        onResolve={offer => {
          const protocolFeeVaultOutpoint = resolveProtocolFeeVaultOutpoint(offer)
          if (!protocolFeeVaultOutpoint) throw new Error('Finalized protocol-fee vault not found')
          const vault = offer.vaults.find(v => v.vault_type === 'protocol_fee' && v.is_finalized)

          setValue('protocolFeeVaultOutpoint', protocolFeeVaultOutpoint)
          setValue('createOfferTxid', offer.created_at_txid)
          setFoundVault(vault ? `balance ${vault.amount.toString()}` : null)
        }}
      />
      {foundVault ? <p className='mt-2 text-xs text-gray-600'>Found: {foundVault}</p> : null}

      <div className='mt-4 flex flex-col gap-3'>
        {renderTextField({
          name: 'protocolFeeVaultOutpoint',
          label: 'Finalized protocol-fee vault AssetAuthVault outpoint',
          placeholder: 'txid:vout',
          description: 'The finalized protocol-fee vault UTXO',
        })}
        {renderTextField({
          name: 'createOfferTxid',
          label: 'Create-offer txid',
          placeholder: '64 hex chars',
          description: 'Used to recover offer parameters and the vault supply goal',
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
          name: 'keeperRecipientAddress',
          label: 'Keeper recipient address (optional)',
          placeholder: 'Leave blank to use wallet receive address',
          description: 'Where the passed-through keeper credential is sent back',
        })}
        {renderTextField({
          name: 'principalRecipientAddress',
          label: 'Principal recipient address (optional)',
          placeholder: 'Leave blank to use wallet receive address',
          description: 'Where the unlocked protocol fee is sent',
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
          loadingText='Claiming...'
          onPress={() => void handleSubmit(onSubmit)()}
        >
          Claim Protocol Fee Vault
        </UiButton>
      </div>

      {state.error ? <p className='mt-3 text-xs text-red-500'>Claim: {state.error}</p> : null}

      <TxResult
        title='Protocol Fee Vault Claimed'
        txid={state.result?.txid ?? null}
        txStatus={txStatus}
        detail={state.result?.summary}
      />
    </div>
  )
}
