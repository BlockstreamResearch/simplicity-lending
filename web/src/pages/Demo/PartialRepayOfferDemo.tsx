import type { WalletTxOut } from '@lilbonekit/lwk-web'
import { type ComponentProps, useCallback, useEffect, useMemo, useState } from 'react'
import { Controller, type Resolver, useForm } from 'react-hook-form'
import { z as zod } from 'zod'

import {
  resolveActiveLenderVaultOutpoint,
  resolveActiveOutpoint,
  resolveActiveProtocolFeeVaultOutpoint,
  resolveBorrowerNftOutpoint,
} from '@/api/indexer/utils'
import { UiButton } from '@/components/ui/UiButton'
import { UiTextField } from '@/components/ui/UiTextField'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { type PartialRepayOfferSummary, usePartialRepayOffer } from '@/hooks/usePartialRepayOffer'
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

const createOfferTxidSchema = zod
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{64}$/, 'Create-offer txid must be 64 hex chars')
  .transform(value => value.toLowerCase())

const optionalUint64Schema = zod.string().trim().regex(/^\d*$/, 'Must be a whole number')

const partialRepayOfferFormSchema = zod.object({
  activeOfferOutpoint: outpointSchema('Active offer outpoint'),
  createOfferTxid: createOfferTxidSchema,
  borrowerNftOutpoint: outpointSchema('Borrower NFT outpoint'),
  amountToRepay: zod
    .string()
    .trim()
    .regex(/^\d+$/, 'Amount to repay must be a whole number')
    .refine(value => BigInt(value) > 0n, 'Amount to repay must be greater than zero'),
  currentDebt: optionalUint64Schema.optional(),
  lenderVaultOutpoint: zod
    .string()
    .trim()
    .regex(/^([0-9a-fA-F]{64}:\d+)?$/, 'Lender vault outpoint must have txid:vout format')
    .optional(),
  protocolFeeVaultOutpoint: zod
    .string()
    .trim()
    .regex(/^([0-9a-fA-F]{64}:\d+)?$/, 'Protocol fee vault outpoint must have txid:vout format')
    .optional(),
  collateralRecipientAddress: zod.string().trim().optional(),
  borrowerNftRecipientAddress: zod.string().trim().optional(),
  principalOutpoints: outpointListSchema('Principal outpoint'),
  feeOutpoints: outpointListSchema('Fee L-BTC outpoint'),
})

type PartialRepayOfferForm = zod.input<typeof partialRepayOfferFormSchema>
type PartialRepayOfferTextField = keyof PartialRepayOfferForm
type PartialRepayOfferTextFieldProps = Omit<
  ComponentProps<typeof UiTextField>,
  'errorMessage' | 'isInvalid' | 'onChange' | 'value'
> & {
  name: PartialRepayOfferTextField
}

const partialRepayOfferFormResolver: Resolver<PartialRepayOfferForm> = async values => {
  const result = partialRepayOfferFormSchema.safeParse(values)
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
  result: { txid: string; summary: PartialRepayOfferSummary } | null
}

interface WalletUtxosState {
  busy: boolean
  error: string | null
}

const EMPTY_FORM: PartialRepayOfferForm = {
  activeOfferOutpoint: '',
  createOfferTxid: '',
  borrowerNftOutpoint: '',
  amountToRepay: '',
  currentDebt: '',
  lenderVaultOutpoint: '',
  protocolFeeVaultOutpoint: '',
  collateralRecipientAddress: '',
  borrowerNftRecipientAddress: '',
  principalOutpoints: '',
  feeOutpoints: '',
}

const INITIAL_STATE: BroadcastState = {
  busy: false,
  error: null,
  result: null,
}

export default function PartialRepayOfferDemo() {
  const { lwkNetwork } = useLwk()
  const { connectionStatus, getBlindedWalletUtxos, syncing, syncWallet } = useWallet()
  const { partialRepayOffer } = usePartialRepayOffer()
  const runStandardTransactionFlow = useStandardTransactionFlow()
  const { control, handleSubmit, setValue } = useForm<PartialRepayOfferForm>({
    defaultValues: EMPTY_FORM,
    mode: 'onSubmit',
    resolver: partialRepayOfferFormResolver,
  })
  const [state, setState] = useState<BroadcastState>({ ...INITIAL_STATE })
  const [walletUtxos, setWalletUtxos] = useState<WalletTxOut[]>([])
  const [walletUtxosState, setWalletUtxosState] = useState<WalletUtxosState>({
    busy: false,
    error: null,
  })
  const { status: txStatus } = useTxStatus(state.result?.txid ?? null)

  const policyAssetId = useMemo(() => lwkNetwork.policyAsset().toString(), [lwkNetwork])
  const principalAsset = NETWORK_CONFIG.principalAsset
  const principalUtxoOptions = useMemo(() => {
    if (connectionStatus !== 'ready') return []
    return walletUtxos
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
  }, [connectionStatus, principalAsset.id, walletUtxos])
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

  const onSubmit = async (formValues: PartialRepayOfferForm) => {
    setState({ busy: true, error: null, result: null })

    try {
      const result = partialRepayOfferFormSchema.safeParse(formValues)
      if (!result.success) {
        throw new Error(result.error.issues.map(issue => issue.message).join('; '))
      }

      const { txid, summary } = await runStandardTransactionFlow(() =>
        partialRepayOffer(result.data),
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

  const renderTextField = ({ name, ...props }: PartialRepayOfferTextFieldProps) => (
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
      <div className='font-bold'>Partial Repay Offer Demo</div>
      <p className='mt-2 max-w-3xl text-sm text-gray-600'>
        Repays an offer, in full or in part, any number of times. All fields below can be filled
        manually — useful for forcing edge-case amounts — or autofilled from the indexer by offer
        id. Run ClaimPrincipalDemo first — the Borrower NFT it outputs is required here.
      </p>

      <OfferIdAutofill
        onResolve={offer => {
          const activeOfferOutpoint = resolveActiveOutpoint(offer)
          if (!activeOfferOutpoint) throw new Error('Active offer UTXO not found')
          const borrowerNftOutpoint = resolveBorrowerNftOutpoint(offer)
          if (!borrowerNftOutpoint) throw new Error('Borrower NFT UTXO not found')

          setValue('activeOfferOutpoint', activeOfferOutpoint)
          setValue('createOfferTxid', offer.created_at_txid)
          setValue('borrowerNftOutpoint', borrowerNftOutpoint)
          setValue('currentDebt', offer.current_debt.toString())
          setValue('lenderVaultOutpoint', resolveActiveLenderVaultOutpoint(offer) ?? '')
          setValue('protocolFeeVaultOutpoint', resolveActiveProtocolFeeVaultOutpoint(offer) ?? '')
        }}
      />

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
            'Original create-offer txid — used to recover offer parameters and the borrower/lender NFT asset ids',
        })}
        {renderTextField({
          name: 'borrowerNftOutpoint',
          label: 'Borrower NFT outpoint',
          placeholder: 'claim-principal-txid:0',
          description: 'ClaimPrincipalDemo outputs the Borrower NFT at vout 0 — use that here',
        })}
        {renderTextField({
          name: 'amountToRepay',
          label: 'Amount to repay',
          placeholder: 'e.g. 100',
          description:
            'In principal asset units. Must be > 0 and <= current debt (principal + full interest).',
        })}
        {renderTextField({
          name: 'currentDebt',
          label: 'Current offer debt (optional)',
          placeholder: 'Leave blank for a fresh offer (defaults to principal + full interest)',
          description:
            'Only needed for a repayment against an offer that already had a prior repayment — use the previous "New active offer Lending" step’s newDebt',
        })}
        {renderTextField({
          name: 'lenderVaultOutpoint',
          label: 'Lender vault outpoint (optional)',
          placeholder: 'txid:vout',
          description:
            'Needed for any repayment after the first one — the active lender vault from the previous step',
        })}
        {renderTextField({
          name: 'protocolFeeVaultOutpoint',
          label: 'Protocol fee vault outpoint (optional)',
          placeholder: 'txid:vout',
          description:
            'Only needed while the offer fee is still being paid off across multiple repayments — the active protocol-fee vault from the previous step',
        })}
        {renderTextField({
          name: 'collateralRecipientAddress',
          label: 'Collateral recipient address (optional)',
          placeholder: 'Leave blank to use wallet receive address',
          description: 'Where the (partially or fully) unlocked collateral is sent',
        })}
        {renderTextField({
          name: 'borrowerNftRecipientAddress',
          label: 'Borrower NFT recipient address (optional)',
          placeholder: 'Leave blank to use wallet receive address',
          description:
            'Only used when the repayment is partial (not final) — the NFT is returned here instead of burned',
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
          Partial Repay Offer
        </UiButton>
      </div>

      {state.error ? <p className='mt-3 text-xs text-red-500'>Repay: {state.error}</p> : null}

      <TxResult
        title='Offer Partially Repaid'
        txid={state.result?.txid ?? null}
        txStatus={txStatus}
        detail={state.result?.summary}
      />
    </div>
  )
}
