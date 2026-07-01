import type { WalletTxOut } from '@lilbonekit/lwk-web'
import { type ComponentProps, useCallback, useEffect, useMemo, useState } from 'react'
import { Controller, type Resolver, useForm } from 'react-hook-form'
import { z as zod } from 'zod'

import { broadcastTx } from '@/api/esplora/methods'
import { getDefaultTransactionSteps } from '@/components/TransactionStepper/transactionSteps'
import { UiButton } from '@/components/ui/UiButton'
import { UiTextField } from '@/components/ui/UiTextField'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { type CreateOfferSummary, useCreateOffer } from '@/hooks/useCreateOffer'
import { useTxStatus } from '@/hooks/useTxStatus'
import { isConfirmedWalletUtxo, isPolicyAssetUtxo } from '@/lwk/utxo'
import { useLwk } from '@/providers/lwk/useLwk'
import { useTxProgress } from '@/providers/txProgress/useTxProgress'
import { useWallet } from '@/providers/wallet/useWallet'
import { isHexStringOfByteLength, normalizeHex } from '@/utils/hex'

import { formatCollateralUtxoOption } from './helpers'
import { TxResult } from './TxResult'

const integerStringSchema = (label: string) =>
  zod.string().trim().regex(/^\d+$/, `${label} must be an integer`)

const bigintStringSchema = (label: string) =>
  integerStringSchema(label).transform(value => BigInt(value))

const numberStringSchema = (label: string) =>
  integerStringSchema(label).transform(value => Number.parseInt(value, 10))

const assetIdStringSchema = (label: string) =>
  zod
    .string()
    .transform(normalizeHex)
    .refine(value => isHexStringOfByteLength(value, 32), {
      message: `${label} must be a 32-byte hex asset id`,
    })

const outpointStringSchema = (label: string) =>
  zod
    .string()
    .trim()
    .regex(/^[0-9a-fA-F]{64}:\d+$/, `${label} must be formatted as txid:vout`)
    .transform(value => value.toLowerCase())

const outpointListSchema = (label: string) =>
  zod
    .string()
    .trim()
    .transform(value => value.split(/[\s,]+/).filter(Boolean))
    .pipe(zod.array(outpointStringSchema(label)).min(1, `${label}: at least one outpoint required`))

const createOfferFormSchema = zod.object({
  factoryAuthOutpoint: outpointStringSchema('FactoryAuth outpoint'),
  issuanceFactoryOutpoint: outpointStringSchema('IssuanceFactory covenant outpoint'),
  factoryAssetId: assetIdStringSchema('Factory asset id'),
  collateralOutpoints: outpointListSchema('Collateral outpoint'),
  collateralAmount: bigintStringSchema('Collateral amount'),
  principalAssetId: assetIdStringSchema('Principal asset id'),
  principalAmount: bigintStringSchema('Principal amount'),
  principalInterestRate: numberStringSchema('Interest rate bps'),
  loanDurationBlocks: numberStringSchema('Loan duration blocks'),
  protocolFeeKeeperAssetId: assetIdStringSchema('Protocol fee keeper asset id'),
})

type CreateOfferForm = zod.input<typeof createOfferFormSchema>
type CreateOfferFormField = keyof CreateOfferForm
type CreateOfferTextFieldProps = Omit<
  ComponentProps<typeof UiTextField>,
  'errorMessage' | 'isInvalid' | 'onChange' | 'value'
> & {
  name: CreateOfferFormField
}

const createOfferFormResolver: Resolver<CreateOfferForm> = async values => {
  const result = createOfferFormSchema.safeParse(values)
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
  summary: CreateOfferSummary | null
  txid: string | null
}

interface WalletUtxosState {
  busy: boolean
  error: string | null
}

const DEFAULT_COLLATERAL_AMOUNT = '3000'
const DEFAULT_PRINCIPAL_AMOUNT = '100'
const DEFAULT_INTEREST_RATE_BPS = '1000'
const DEFAULT_LOAN_DURATION_BLOCKS = '144'

const INITIAL_STATE: BroadcastState = {
  busy: false,
  error: null,
  summary: null,
  txid: null,
}

const EMPTY_FORM: CreateOfferForm = {
  // Update factoryAuthOutpoint and issuanceFactoryOutpoint
  // with the last create offer tx:0 and tx:1
  // every time you use VITE_DEBUG_MNEMONIC
  factoryAuthOutpoint: '0d9998a979d7ef048b514d9186e756b869119d234f32824a59f0f2c0d174be34:0',
  issuanceFactoryOutpoint: '0d9998a979d7ef048b514d9186e756b869119d234f32824a59f0f2c0d174be34:1',
  factoryAssetId: 'a61ab9c860e382039cb5df9386319887c1a3e60116f5fcb7ad3497b430806d18',
  collateralOutpoints: '',
  collateralAmount: DEFAULT_COLLATERAL_AMOUNT,
  principalAssetId: NETWORK_CONFIG.principalAsset.id,
  principalAmount: DEFAULT_PRINCIPAL_AMOUNT,
  principalInterestRate: DEFAULT_INTEREST_RATE_BPS,
  loanDurationBlocks: DEFAULT_LOAN_DURATION_BLOCKS,
  protocolFeeKeeperAssetId: NETWORK_CONFIG.protocolFeeAsset.id,
}

export default function CreateOfferDemo() {
  const { lwkNetwork } = useLwk()
  const { connectionStatus, syncing, syncWallet, getBlindedWalletUtxos, signPset, signerType } =
    useWallet()
  const { createOffer } = useCreateOffer()
  const { start, fail } = useTxProgress()
  const { control, handleSubmit } = useForm<CreateOfferForm>({
    defaultValues: EMPTY_FORM,
    mode: 'onSubmit',
    resolver: createOfferFormResolver,
  })
  const [state, setState] = useState<BroadcastState>({ ...INITIAL_STATE })
  const [blindedWalletUtxos, setBlindedWalletUtxos] = useState<WalletTxOut[]>([])
  const [blindedWalletUtxosState, setBlindedWalletUtxosState] = useState<WalletUtxosState>({
    busy: false,
    error: null,
  })
  const { status: txStatus } = useTxStatus(state.txid)

  const policyAssetId = useMemo(() => lwkNetwork.policyAsset().toString(), [lwkNetwork])
  const collateralUtxoOptions = useMemo(() => {
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

  const onSubmit = async (formValues: CreateOfferForm) => {
    setState(current => ({ ...current, busy: true, error: null, summary: null, txid: null }))
    try {
      const result = createOfferFormSchema.safeParse(formValues)
      if (!result.success) {
        throw new Error(result.error.issues.map(issue => issue.message).join('; '))
      }
      const advance = await start(getDefaultTransactionSteps(signerType))
      const { pset, finalize } = await createOffer(result.data)
      await advance('signing')
      const signedPset = await signPset(pset)
      await advance('finalizing')
      const { finalizedTx, summary } = finalize(signedPset)
      await advance('broadcasting')
      const txid = await broadcastTx(finalizedTx.toString())
      setState({ busy: false, error: null, txid, summary })
    } catch (err) {
      fail(err)
      setState(current => ({
        ...current,
        busy: false,
        error: err instanceof Error ? err.message : String(err),
      }))
    }
  }

  const renderTextField = ({ name, ...props }: CreateOfferTextFieldProps) => (
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
      <div className='font-bold'>Create Offer Demo</div>
      <p className='mt-2 max-w-3xl text-sm text-gray-600'>
        Builds one offer creation transaction: FactoryAuth input, IssuanceFactory covenant input,
        and one or more LBTC collateral inputs. Borrower account UTXOs are entered manually.
      </p>

      <div className='mt-4 flex flex-col gap-3'>
        {renderTextField({
          name: 'factoryAuthOutpoint',
          label: 'FactoryAuth outpoint',
          placeholder: 'txid:0',
          description: 'Manual fallback for explicit wallet UTXOs that LWK scan does not list',
        })}
        {renderTextField({
          name: 'issuanceFactoryOutpoint',
          label: 'IssuanceFactory covenant outpoint',
          placeholder: 'txid:1',
        })}
        {renderTextField({
          name: 'factoryAssetId',
          label: 'Factory asset id',
          placeholder: '64 hex chars',
        })}
        {renderTextField({
          name: 'collateralOutpoints',
          label: 'Collateral LBTC outpoint(s)',
          placeholder: 'txid:vout, txid:vout, ...',
          description: collateralUtxoOptions.length
            ? `Available: ${collateralUtxoOptions.map(option => option.label).join(' | ')}`
            : 'No wallet LBTC UTXOs loaded',
        })}

        {renderTextField({
          name: 'collateralAmount',
          label: 'Collateral amount',
        })}
        {renderTextField({
          name: 'principalAmount',
          label: 'Principal amount',
        })}
        {renderTextField({
          name: 'principalAssetId',
          label: 'Principal asset id',
        })}
        {renderTextField({
          name: 'protocolFeeKeeperAssetId',
          label: 'Protocol fee keeper asset id',
        })}
        {renderTextField({
          name: 'principalInterestRate',
          label: 'Interest rate bps',
        })}
        {renderTextField({
          name: 'loanDurationBlocks',
          label: 'Loan duration blocks',
        })}
      </div>

      <div className='mt-3 rounded bg-gray-50 p-3 text-xs text-gray-600'>
        Collateral asset is wallet policy asset: <span className='break-all'>{policyAssetId}</span>
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
          Refresh LBTC UTXOs
        </UiButton>
        <UiButton
          isDisabled={connectionStatus !== 'ready'}
          isPending={state.busy}
          loadingText='Creating offer...'
          onPress={() => void handleSubmit(onSubmit)()}
        >
          Create Offer
        </UiButton>
      </div>

      {state.error ? <p className='mt-3 text-xs text-red-500'>Create: {state.error}</p> : null}

      <TxResult
        title='Offer Created'
        txid={state.txid}
        txStatus={txStatus}
        detail={state.summary ?? undefined}
      />
    </div>
  )
}
