import type { WalletTxOut } from 'lwk_web'
import { type ComponentProps, useCallback, useEffect, useMemo, useState } from 'react'
import { Controller, type Resolver, useForm } from 'react-hook-form'
import { z as zod } from 'zod'

import { UiButton } from '@/components/ui/UiButton'
import { UiSelect } from '@/components/ui/UiSelect'
import { UiTextField } from '@/components/ui/UiTextField'
import { NETWORK_CONFIG } from '@/constants/network-config'
import {
  type CreateOfferParams,
  type CreateOfferResult,
  useCreateOffer,
} from '@/hooks/useCreateOffer'
import { isPolicyAssetUtxo } from '@/lwk/utxo'
import { useLwk } from '@/providers/lwk/useLwk'
import { useWallet } from '@/providers/wallet/useWallet'
import { isHexStringOfByteLength, normalizeHex } from '@/utils/hex'

import { formatCollateralUtxoOption, useTxConfirmations } from './helpers'
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

const createOfferFormSchema = zod.object({
  factoryAuthOutpoint: outpointStringSchema('FactoryAuth outpoint'),
  issuanceFactoryOutpoint: outpointStringSchema('IssuanceFactory covenant outpoint'),
  factoryAssetId: assetIdStringSchema('Factory asset id'),
  collateralOutpoint: outpointStringSchema('Collateral outpoint'),
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
  summary: CreateOfferResult['summary'] | null
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
  collateralOutpoint: '',
  collateralAmount: DEFAULT_COLLATERAL_AMOUNT,
  principalAssetId: NETWORK_CONFIG.principalAsset.id,
  principalAmount: DEFAULT_PRINCIPAL_AMOUNT,
  principalInterestRate: DEFAULT_INTEREST_RATE_BPS,
  loanDurationBlocks: DEFAULT_LOAN_DURATION_BLOCKS,
  protocolFeeKeeperAssetId: NETWORK_CONFIG.protocolFeeAsset.id,
}

export default function CreateOfferDemo() {
  const { lwkNetwork } = useLwk()
  const { connectionStatus, syncing, syncWallet, getWalletUtxos } = useWallet()
  const { createOffer } = useCreateOffer()
  const { control, handleSubmit } = useForm<CreateOfferForm>({
    defaultValues: EMPTY_FORM,
    mode: 'onSubmit',
    resolver: createOfferFormResolver,
  })
  const [state, setState] = useState<BroadcastState>({ ...INITIAL_STATE })
  const [walletUtxos, setWalletUtxos] = useState<WalletTxOut[]>([])
  const [walletUtxosState, setWalletUtxosState] = useState<WalletUtxosState>({
    busy: false,
    error: null,
  })
  const confirmations = useTxConfirmations(state.txid)

  const policyAssetId = useMemo(() => lwkNetwork.policyAsset().toString(), [lwkNetwork])
  const collateralUtxoOptions = useMemo(() => {
    if (connectionStatus !== 'ready') return []

    return walletUtxos
      .filter(utxo => isPolicyAssetUtxo(utxo, policyAssetId))
      .map(formatCollateralUtxoOption)
  }, [connectionStatus, policyAssetId, walletUtxos])

  const refreshWalletUtxos = useCallback(async () => {
    setWalletUtxosState({ busy: true, error: null })

    try {
      await syncWallet()
      setWalletUtxos(await getWalletUtxos())
      setWalletUtxosState({ busy: false, error: null })
    } catch (err) {
      setWalletUtxosState({
        busy: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }, [getWalletUtxos, syncWallet])

  useEffect(() => {
    if (connectionStatus !== 'ready') return

    let cancelled = false
    getWalletUtxos()
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
  }, [connectionStatus, getWalletUtxos])

  const onSubmit = async (formValues: CreateOfferForm) => {
    setState(current => ({ ...current, busy: true, error: null, summary: null, txid: null }))
    try {
      const result = createOfferFormSchema.safeParse(formValues)
      if (!result.success) {
        throw new Error(result.error.issues.map(issue => issue.message).join('; '))
      }
      const { txid, summary } = await createOffer(result.data as CreateOfferParams)
      setState({ busy: false, error: null, txid, summary })
    } catch (err) {
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
        and LBTC collateral input. Borrower account UTXOs are entered manually.
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
        <Controller
          control={control}
          name='collateralOutpoint'
          render={({ field, fieldState }) => (
            <UiSelect
              label='Collateral LBTC outpoint'
              placeholder='Select wallet LBTC UTXO'
              options={collateralUtxoOptions}
              selectedKey={field.value || null}
              errorMessage={fieldState.error?.message}
              onSelectionChange={key => field.onChange(key ? String(key) : '')}
              description={
                collateralUtxoOptions.length
                  ? `${collateralUtxoOptions.length} wallet LBTC UTXO(s)`
                  : 'No wallet LBTC UTXOs loaded'
              }
            />
          )}
        />

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
        confirmations={confirmations}
        detail={state.summary ?? undefined}
      />
    </div>
  )
}
