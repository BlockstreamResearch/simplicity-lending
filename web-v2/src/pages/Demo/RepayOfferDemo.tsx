import type { WalletTxOut } from 'lwk_web'
import { type ComponentProps, useCallback, useEffect, useMemo, useState } from 'react'
import { Controller, type Resolver, useForm } from 'react-hook-form'
import { z as zod } from 'zod'

import { UiButton } from '@/components/ui/UiButton'
import { UiSelect } from '@/components/ui/UiSelect'
import { UiTextField } from '@/components/ui/UiTextField'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { type RepayOfferResult, useRepayOffer } from '@/hooks/useRepayOffer'
import { useTxStatus } from '@/hooks/useTxStatus'
import { isPolicyAssetUtxo, utxoToOutpointString } from '@/lwk/utxo'
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

const repayOfferFormSchema = zod.object({
  activeOfferOutpoint: outpointSchema('Active offer outpoint'),
  borrowerNftOutpoint: outpointSchema('Borrower NFT outpoint'),
  collateralRecipientAddress: zod.string().trim().optional(),
  principalOutpoint: outpointSchema('Principal outpoint'),
  feeOutpoint: outpointSchema('Fee L-BTC outpoint'),
})

type RepayOfferForm = zod.input<typeof repayOfferFormSchema>
type RepayOfferTextField = Exclude<keyof RepayOfferForm, 'principalOutpoint' | 'feeOutpoint'>
type RepayOfferTextFieldProps = Omit<
  ComponentProps<typeof UiTextField>,
  'errorMessage' | 'isInvalid' | 'onChange' | 'value'
> & {
  name: RepayOfferTextField
}

const repayOfferFormResolver: Resolver<RepayOfferForm> = async values => {
  const result = repayOfferFormSchema.safeParse(values)
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
  result: RepayOfferResult | null
}

interface WalletUtxosState {
  busy: boolean
  error: string | null
}

const EMPTY_FORM: RepayOfferForm = {
  activeOfferOutpoint: '',
  borrowerNftOutpoint: '',
  collateralRecipientAddress: '',
  principalOutpoint: '',
  feeOutpoint: '',
}

const INITIAL_STATE: BroadcastState = {
  busy: false,
  error: null,
  result: null,
}

export default function RepayOfferDemo() {
  const { lwkNetwork } = useLwk()
  const { connectionStatus, getBlindedWalletUtxos, syncing, syncWallet } = useWallet()
  const { repayOffer } = useRepayOffer()
  const { control, handleSubmit } = useForm<RepayOfferForm>({
    defaultValues: EMPTY_FORM,
    mode: 'onSubmit',
    resolver: repayOfferFormResolver,
  })
  const [state, setState] = useState<BroadcastState>({ ...INITIAL_STATE })
  const [walletUtxos, setWalletUtxos] = useState<WalletTxOut[]>([])
  const [walletUtxosState, setWalletUtxosState] = useState<WalletUtxosState>({
    busy: false,
    error: null,
  })
  const txStatus = useTxStatus(state.result?.txid ?? null)

  const policyAssetId = useMemo(() => lwkNetwork.policyAsset().toString(), [lwkNetwork])
  const principalAsset = NETWORK_CONFIG.principalAsset
  const principalUtxoOptions = useMemo(() => {
    if (connectionStatus !== 'ready') return []
    return walletUtxos
      .filter(utxo => utxo.unblinded().asset().toString() === principalAsset.id)
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
  }, [connectionStatus, principalAsset.id, walletUtxos])
  const feeUtxoOptions = useMemo(() => {
    if (connectionStatus !== 'ready') return []
    return walletUtxos
      .filter(utxo => isPolicyAssetUtxo(utxo, policyAssetId))
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

  const onSubmit = async (formValues: RepayOfferForm) => {
    setState({ busy: true, error: null, result: null })

    try {
      const result = repayOfferFormSchema.safeParse(formValues)
      if (!result.success) {
        throw new Error(result.error.issues.map(issue => issue.message).join('; '))
      }

      setState({
        busy: false,
        error: null,
        result: await repayOffer(result.data),
      })
    } catch (err) {
      setState({
        busy: false,
        error: err instanceof Error ? err.message : String(err),
        result: null,
      })
    }
  }

  const renderTextField = ({ name, ...props }: RepayOfferTextFieldProps) => (
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
      <div className='font-bold'>Repay Offer Demo</div>
      <p className='mt-2 max-w-3xl text-sm text-gray-600'>
        Full repayment: spends the active Lending covenant and the Borrower NFT, burns the NFT,
        creates the finalized lender and protocol-fee vaults, and returns the unlocked collateral to
        the specified address. Run ClaimPrincipalDemo first — repayment burns the Borrower NFT, so
        the principal must be claimed beforehand.
      </p>

      <div className='mt-4 flex flex-col gap-3'>
        {renderTextField({
          name: 'activeOfferOutpoint',
          label: 'Active offer Lending outpoint',
          placeholder: 'accept-offer-txid:0',
          description: 'AcceptOfferDemo places the active Lending covenant at vout 0',
        })}
        {renderTextField({
          name: 'borrowerNftOutpoint',
          label: 'Borrower NFT outpoint',
          placeholder: 'claim-principal-txid:0',
          description:
            'ClaimPrincipalDemo outputs the Borrower NFT at vout 0 — use that outpoint here; repayment burns it',
        })}
        {renderTextField({
          name: 'collateralRecipientAddress',
          label: 'Collateral recipient address (optional)',
          placeholder: 'Leave blank to use wallet receive address',
          description: 'Where the unlocked collateral is sent after full repayment',
        })}
        <Controller
          control={control}
          name='principalOutpoint'
          render={({ field, fieldState }) => (
            <UiSelect
              label='Principal asset outpoint'
              placeholder='Select wallet principal UTXO'
              options={principalUtxoOptions}
              selectedKey={field.value || null}
              errorMessage={fieldState.error?.message}
              onSelectionChange={key => field.onChange(key ? String(key) : '')}
              description={
                `Filtered by ${principalAsset.symbol} asset: ${principalAsset.id}. ` +
                (principalUtxoOptions.length
                  ? `${principalUtxoOptions.length} matching wallet UTXO(s); must cover total amount to repay (principal + interest)`
                  : 'No matching wallet UTXOs loaded')
              }
            />
          )}
        />
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
          loadingText='Repaying offer...'
          onPress={() => void handleSubmit(onSubmit)()}
        >
          Repay Offer
        </UiButton>
      </div>

      {state.error ? <p className='mt-3 text-xs text-red-500'>Repay: {state.error}</p> : null}

      <TxResult
        title='Offer Repaid'
        txid={state.result?.txid ?? null}
        txStatus={txStatus}
        detail={state.result?.summary}
      />
    </div>
  )
}
