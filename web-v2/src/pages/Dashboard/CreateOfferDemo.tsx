import {
  Address,
  AssetId,
  assetIdFromIssuance,
  ContractHash,
  ExternalUtxo,
  IssuanceRecipient,
  type Network,
  OutPoint,
  Script,
  SimplicityLogLevel,
  Transaction,
  TxBuilder,
  TxOutSecrets,
  type WalletTxOut,
} from 'lwk_web'
import { type ComponentProps, useCallback, useEffect, useMemo, useState } from 'react'
import { Controller, type Resolver, useForm } from 'react-hook-form'
import { z as zod } from 'zod'

import { broadcastTx, fetchLatestBlockHeight, fetchTxRaw } from '@/api/esplora/methods'
import { getTxExplorerUrl } from '@/api/esplora/utils'
import { UiButton } from '@/components/ui/UiButton'
import { UiSelect, type UiSelectOption } from '@/components/ui/UiSelect'
import { UiTextField } from '@/components/ui/UiTextField'
import { findUtxoByOutpoint, getPolicyAssetUtxos, outpointToString } from '@/lwk/utxo'
import { useLwk } from '@/providers/lwk/useLwk'
import { useWallet } from '@/providers/wallet/useWallet'
import {
  buildIssuanceFactoryWitness,
  loadIssuanceFactoryProgram,
} from '@/simplicity/issuance-factory/program'
import {
  buildDerivedLendingOfferProgramParams,
  buildPendingOfferMetadata,
  loadLendingProgram,
} from '@/simplicity/lending/program'
import { useTxConfirmations } from '@/simplicity/script-auth/helpers'
import { loadScriptAuthProgram } from '@/simplicity/script-auth/program'
import { bytesToHex, hexToBytes, isHexStringOfByteLength, normalizeHex } from '@/utils/hex'

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
type ParsedCreateOfferForm = zod.output<typeof createOfferFormSchema>
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

interface CreateOfferSummary {
  inputs: Record<string, string>
  outputs: Record<string, string>
  assetIds: Record<string, string>
  scripts: Record<string, string>
  offerParameters: Record<string, string>
  metadataOpReturnHex: string
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

const TEST_ASSET_ID = '38fca2d939696061a8f76d4e6b5eecd54e3b4221c846f24a6b279e79952850a5'
const DEFAULT_COLLATERAL_AMOUNT = '3000'
const DEFAULT_PRINCIPAL_AMOUNT = '10000'
const DEFAULT_INTEREST_RATE_BPS = '1000'
const DEFAULT_LOAN_DURATION_BLOCKS = '144'
const ISSUING_UTXOS_COUNT = 2
const REISSUANCE_FLAGS = 0n
const REISSUANCE_TOKEN_AMOUNT = 0n
const NFT_AMOUNT = 1n
const DEFAULT_FEE_RATE = 100
const DEFAULT_EXTERNAL_UTXO_MAX_WEIGHT_TO_SATISFY = 30_000

const INITIAL_STATE: BroadcastState = {
  busy: false,
  error: null,
  summary: null,
  txid: null,
}

const EMPTY_FORM: CreateOfferForm = {
  factoryAuthOutpoint: '6ad27ff9c22819f98a8f08cf777d370c0b30549bee6f8cd86c3522ab203b5018:0',
  issuanceFactoryOutpoint: '6ad27ff9c22819f98a8f08cf777d370c0b30549bee6f8cd86c3522ab203b5018:1',
  factoryAssetId: 'a61ab9c860e382039cb5df9386319887c1a3e60116f5fcb7ad3497b430806d18',
  collateralOutpoint: '',
  collateralAmount: DEFAULT_COLLATERAL_AMOUNT,
  principalAssetId: TEST_ASSET_ID,
  principalAmount: DEFAULT_PRINCIPAL_AMOUNT,
  principalInterestRate: DEFAULT_INTEREST_RATE_BPS,
  loanDurationBlocks: DEFAULT_LOAN_DURATION_BLOCKS,
  protocolFeeKeeperAssetId: TEST_ASSET_ID,
}

export default function CreateOfferDemo() {
  const { lwkNetwork } = useLwk()
  const {
    connectionStatus,
    getReceiveAddress,
    getWalletUtxos,
    getWollet,
    getXOnlyPublicKey,
    signPset,
    syncWallet,
  } = useWallet()
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
  const collateralUtxoOptions = useMemo(
    () => getPolicyAssetUtxos(walletUtxos, policyAssetId).map(formatCollateralUtxoOption),
    [policyAssetId, walletUtxos],
  )

  const refreshWalletUtxos = useCallback(async () => {
    if (connectionStatus !== 'ready') {
      setWalletUtxos([])
      setWalletUtxosState({ busy: false, error: null })
      return
    }

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
  }, [connectionStatus, getWalletUtxos, syncWallet])

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      void refreshWalletUtxos()
    }, 0)

    return () => clearTimeout(timeoutId)
  }, [refreshWalletUtxos])

  const createOffer = async (formValues: CreateOfferForm) => {
    setState(current => ({ ...current, busy: true, error: null, summary: null, txid: null }))

    let createStage = 'initializing'
    try {
      createStage = 'parse and validate form'
      const parsedForm = parseCreateOfferForm(formValues)

      createStage = 'get x-only public key'
      const key = await getXOnlyPublicKey()
      if (!key) {
        throw new Error('Missing x-only public key')
      }

      createStage = 'get receive address'
      const receiveAddressString = await getReceiveAddress()
      if (!receiveAddressString) {
        throw new Error('Missing receive address')
      }

      createStage = 'get wollet'
      const wollet = await getWollet()
      if (!wollet) {
        throw new Error('Wallet not connected')
      }

      createStage = 'sync wallet and load UTXOs'
      await syncWallet()
      const walletUtxos = await getWalletUtxos()
      setWalletUtxos(walletUtxos)
      const factoryAuthUtxo = findUtxoByOutpoint(walletUtxos, parsedForm.factoryAuthOutpoint)
      const collateralUtxo = requireWalletUtxo(
        walletUtxos,
        parsedForm.collateralOutpoint,
        'Collateral',
      )

      createStage = 'prepare validated form values'
      const factoryAsset = parseAssetId(parsedForm.factoryAssetId)
      const principalAsset = parseAssetId(parsedForm.principalAssetId)
      const protocolFeeKeeperAsset = parseAssetId(parsedForm.protocolFeeKeeperAssetId)
      const policyAsset = lwkNetwork.policyAsset()
      const factoryAssetString = factoryAsset.toString()
      const principalAssetString = principalAsset.toString()
      const protocolFeeKeeperAssetString = protocolFeeKeeperAsset.toString()
      const policyAssetString = policyAsset.toString()

      if (factoryAuthUtxo) {
        assertWalletUtxoAssetAndAmount(
          factoryAuthUtxo,
          factoryAssetString,
          NFT_AMOUNT,
          'FactoryAuth',
        )
      }
      assertWalletUtxoAssetAndAmount(
        collateralUtxo,
        policyAssetString,
        parsedForm.collateralAmount,
        'Collateral',
      )

      const factoryAuthOutpointString = parsedForm.factoryAuthOutpoint
      const issuanceFactoryOutpointString = parsedForm.issuanceFactoryOutpoint
      const collateralOutpointString = parsedForm.collateralOutpoint
      const issuanceFactoryOutpoint = parseOutPoint(issuanceFactoryOutpointString)
      const collateralOutpoint = parseOutPoint(collateralOutpointString)

      createStage = 'prepare addresses and IssuanceFactory external UTXO'
      const receiveAddressExplicitString = Address.parse(receiveAddressString, lwkNetwork)
        .toUnconfidential()
        .toString()
      const issuanceFactoryProgram = loadIssuanceFactoryProgram({
        issuingUtxosCount: ISSUING_UTXOS_COUNT,
        reissuanceFlags: REISSUANCE_FLAGS,
      })
      const issuanceFactoryAddress = issuanceFactoryProgram.createP2trAddress(key, lwkNetwork)
      const issuanceFactoryAddressString = issuanceFactoryAddress.toString()

      const issuanceFactoryTx = Transaction.fromBytes(
        await fetchTxRaw(issuanceFactoryOutpoint.txid().toString()),
      )
      const issuanceFactoryTxOut = issuanceFactoryTx.outputs[issuanceFactoryOutpoint.vout()]
      if (!issuanceFactoryTxOut) {
        throw new Error('IssuanceFactory transaction does not have the selected output')
      }

      const issuanceFactoryExternalUtxo = new ExternalUtxo(
        issuanceFactoryOutpoint.vout(),
        issuanceFactoryTx,
        TxOutSecrets.fromExplicit(parseAssetId(factoryAssetString), NFT_AMOUNT),
        DEFAULT_EXTERNAL_UTXO_MAX_WEIGHT_TO_SATISFY,
        true,
      )
      const factoryAuthExternalUtxo = factoryAuthUtxo
        ? null
        : await buildExplicitExternalUtxo(
            factoryAuthOutpointString,
            factoryAssetString,
            NFT_AMOUNT,
            'FactoryAuth',
          )

      const borrowerNftAsset = assetIdFromIssuance(issuanceFactoryOutpoint, emptyContractHash())
      const lenderNftAsset = assetIdFromIssuance(collateralOutpoint, emptyContractHash())
      const borrowerNftAssetString = borrowerNftAsset.toString()
      const lenderNftAssetString = lenderNftAsset.toString()
      const currentBlockHeight = await fetchLatestBlockHeight()
      const loanDurationBlocks = parsedForm.loanDurationBlocks
      const offerParameters = {
        collateralAmount: parsedForm.collateralAmount,
        principalAmount: parsedForm.principalAmount,
        principalInterestRate: parsedForm.principalInterestRate,
        loanExpirationTime: currentBlockHeight + loanDurationBlocks,
      }

      createStage = 'compile lending and ScriptAuth programs'
      const derivedLendingParams = buildDerivedLendingOfferProgramParams(
        {
          collateralAssetId: parseAssetId(policyAssetString).toBytes(),
          principalAssetId: parseAssetId(principalAssetString).toBytes(),
          borrowerNftAssetId: parseAssetId(borrowerNftAssetString).toBytes(),
          lenderNftAssetId: parseAssetId(lenderNftAssetString).toBytes(),
          protocolFeeKeeperAssetId: parseAssetId(protocolFeeKeeperAssetString).toBytes(),
          offerParameters,
        },
        key,
        lwkNetwork,
      )
      const lendingProgram = loadLendingProgram(derivedLendingParams)
      const lendingAddress = lendingProgram.createP2trAddress(key, lwkNetwork)
      const lendingAddressString = lendingAddress.toString()
      const lendingScriptPubkeyHex = bytesToHex(lendingAddress.scriptPubkey().bytes())
      const lendingScriptHash = hexToBytes(new Script(lendingScriptPubkeyHex).jet_sha256_hex())
      const lenderNftScriptAuthProgram = loadScriptAuthProgram(lendingScriptHash)
      const lenderNftScriptAuthAddress = lenderNftScriptAuthProgram.createP2trAddress(
        key,
        lwkNetwork,
      )
      const lenderNftScriptAuthAddressString = lenderNftScriptAuthAddress.toString()
      const metadata = await buildPendingOfferMetadata({
        principalAssetId: parseAssetId(principalAssetString).toBytes(),
        offerParameters,
      })

      createStage = 'TxBuilder.new'
      let txBuilder = new TxBuilder(lwkNetwork)

      createStage = 'TxBuilder.feeRate'
      txBuilder = txBuilder.feeRate(DEFAULT_FEE_RATE)

      createStage = 'TxBuilder.setInputOrder'
      txBuilder = txBuilder.setInputOrder([
        parseOutPoint(factoryAuthOutpointString),
        parseOutPoint(issuanceFactoryOutpointString),
        parseOutPoint(collateralOutpointString),
      ])

      const externalUtxos = factoryAuthExternalUtxo
        ? [factoryAuthExternalUtxo, issuanceFactoryExternalUtxo]
        : [issuanceFactoryExternalUtxo]

      createStage = 'TxBuilder.addExternalUtxos covenant/explicit inputs'
      txBuilder = txBuilder.addExternalUtxos(externalUtxos)

      createStage = 'TxBuilder.addExplicitRecipient FactoryAuth back to user'
      txBuilder = txBuilder.addExplicitRecipient(
        parseAddress(receiveAddressExplicitString, lwkNetwork),
        NFT_AMOUNT,
        parseAssetId(factoryAssetString),
      )

      createStage = 'TxBuilder.addExplicitRecipient IssuanceFactory covenant'
      txBuilder = txBuilder.addExplicitRecipient(
        parseAddress(issuanceFactoryAddressString, lwkNetwork),
        NFT_AMOUNT,
        parseAssetId(factoryAssetString),
      )

      createStage = 'TxBuilder.issueAssetToRecipients Borrower NFT to user'
      txBuilder = txBuilder.issueAssetToRecipients(
        [
          IssuanceRecipient.fromAddress(
            NFT_AMOUNT,
            parseAddress(receiveAddressExplicitString, lwkNetwork),
          ),
        ],
        REISSUANCE_TOKEN_AMOUNT,
        null,
        null,
        parseOutPoint(issuanceFactoryOutpointString),
      )

      createStage = 'TxBuilder.issueAssetToRecipients Lender NFT to ScriptAuth'
      txBuilder = txBuilder.issueAssetToRecipients(
        [
          IssuanceRecipient.fromAddress(
            NFT_AMOUNT,
            parseAddress(lenderNftScriptAuthAddressString, lwkNetwork),
          ),
        ],
        REISSUANCE_TOKEN_AMOUNT,
        null,
        null,
        parseOutPoint(collateralOutpointString),
      )

      createStage = 'TxBuilder.addExplicitScriptOutput metadata OP_RETURN'
      txBuilder = txBuilder.addExplicitScriptOutput(
        Script.newOpReturn(metadata),
        0n,
        parseAssetId(policyAssetString),
      )

      createStage = 'TxBuilder.addExplicitScriptOutput Lending covenant collateral'
      txBuilder = txBuilder.addExplicitScriptOutput(
        new Script(lendingScriptPubkeyHex),
        offerParameters.collateralAmount,
        parseAssetId(policyAssetString),
      )

      createStage = 'TxBuilder.finish'
      const pset = txBuilder.finish(wollet)

      createStage = 'sign offer PSET'
      const signedPset = await signPset(pset)

      createStage = 'finalize wallet inputs'
      const finalizedWalletPset = wollet.finalize(signedPset)

      createStage = 'load previous txouts for Simplicity finalize'
      const finalizationFactoryAuthOutpoint = parseOutPoint(factoryAuthOutpointString)
      const finalizationCollateralOutpoint = parseOutPoint(collateralOutpointString)
      const factoryAuthTx = Transaction.fromBytes(
        await fetchTxRaw(finalizationFactoryAuthOutpoint.txid().toString()),
      )
      const factoryAuthTxOut = factoryAuthTx.outputs[finalizationFactoryAuthOutpoint.vout()]
      if (!factoryAuthTxOut) {
        throw new Error('FactoryAuth transaction does not have the selected output')
      }

      const collateralTx = Transaction.fromBytes(
        await fetchTxRaw(finalizationCollateralOutpoint.txid().toString()),
      )
      const collateralTxOut = collateralTx.outputs[finalizationCollateralOutpoint.vout()]
      if (!collateralTxOut) {
        throw new Error('Collateral transaction does not have the selected output')
      }

      createStage = 'finalize IssuanceFactory covenant input'
      const txWithWalletWitnesses = finalizedWalletPset.extractTx()

      const finalizedTx = issuanceFactoryProgram.finalizeTransaction(
        txWithWalletWitnesses,
        key,
        [factoryAuthTxOut, issuanceFactoryTxOut, collateralTxOut],
        1,
        buildIssuanceFactoryWitness({
          branch: 'IssueAssets',
          outputIndex: 0,
        }),
        lwkNetwork,
        SimplicityLogLevel.Trace,
      )

      createStage = 'broadcast transaction'
      const txid = await broadcastTx(finalizedTx.toString())

      setState({
        busy: false,
        error: null,
        summary: {
          inputs: {
            '0 FactoryAuth': parsedForm.factoryAuthOutpoint,
            '1 IssuanceFactory covenant': parsedForm.issuanceFactoryOutpoint,
            '2 Collateral LBTC': parsedForm.collateralOutpoint,
          },
          outputs: {
            '0 FactoryAuth back to user': receiveAddressExplicitString,
            '1 IssuanceFactory back to covenant': issuanceFactoryAddressString,
            '2 Borrower NFT to user': receiveAddressExplicitString,
            '3 Lender NFT to ScriptAuth': lenderNftScriptAuthAddressString,
            '4 Metadata OP_RETURN': bytesToHex(Script.newOpReturn(metadata).bytes()),
            '5 Lending covenant': lendingAddressString,
          },
          assetIds: {
            factoryAssetId: factoryAssetString,
            collateralAssetId: policyAssetString,
            principalAssetId: principalAssetString,
            borrowerNftAssetId: borrowerNftAssetString,
            lenderNftAssetId: lenderNftAssetString,
            protocolFeeKeeperAssetId: protocolFeeKeeperAssetString,
          },
          scripts: {
            lendingScriptHash: bytesToHex(lendingScriptHash),
            lenderVaultCovHash: bytesToHex(derivedLendingParams.lenderVaultCovHash),
            finalizedLenderVaultCovHash: bytesToHex(
              derivedLendingParams.finalizedLenderVaultCovHash,
            ),
            protocolFeeVaultCovHash: bytesToHex(derivedLendingParams.protocolFeeVaultCovHash),
            finalizedProtocolFeeVaultCovHash: bytesToHex(
              derivedLendingParams.finalizedProtocolFeeVaultCovHash,
            ),
            principalOutputScriptHash: bytesToHex(derivedLendingParams.principalOutputScriptHash),
          },
          offerParameters: {
            collateralAmount: offerParameters.collateralAmount.toString(),
            principalAmount: offerParameters.principalAmount.toString(),
            principalInterestRate: offerParameters.principalInterestRate.toString(),
            currentBlockHeight: currentBlockHeight.toString(),
            loanDurationBlocks: loanDurationBlocks.toString(),
            loanExpirationTime: offerParameters.loanExpirationTime.toString(),
          },
          metadataOpReturnHex: bytesToHex(Script.newOpReturn(metadata).bytes()),
        },
        txid,
      })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      const errorBody =
        err instanceof Error && 'body' in err && typeof err.body === 'string' ? err.body : null
      setState(current => ({
        ...current,
        busy: false,
        error: `${createStage}: ${errorMessage}${errorBody ? ` | response: ${errorBody}` : ''}`,
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

      <div className='mt-4 space-y-4'>
        <div className='grid gap-3 md:grid-cols-2'>
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
        </div>

        <div className='grid gap-3 md:grid-cols-2'>
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
          isDisabled={connectionStatus !== 'ready' || walletUtxosState.busy}
          isPending={walletUtxosState.busy}
          loadingText='Refreshing...'
          onPress={refreshWalletUtxos}
        >
          Refresh LBTC UTXOs
        </UiButton>
        <UiButton
          isDisabled={connectionStatus !== 'ready'}
          isPending={state.busy}
          loadingText='Creating offer...'
          onPress={() => void handleSubmit(createOffer)()}
        >
          Create Offer
        </UiButton>
      </div>

      {state.error ? <p className='mt-3 text-xs text-red-500'>Create: {state.error}</p> : null}

      <BroadcastResult txid={state.txid} confirmations={confirmations} summary={state.summary} />
    </div>
  )
}

function BroadcastResult({
  confirmations,
  summary,
  txid,
}: {
  confirmations: number | null
  summary: CreateOfferSummary | null
  txid: string | null
}) {
  if (!txid) {
    return null
  }

  return (
    <div className='mt-4 rounded border border-green-500 bg-green-50 p-4'>
      <div className='font-bold'>Offer Created</div>
      <a
        className='mt-2 block break-all text-blue-600 underline'
        href={getTxExplorerUrl(txid)}
        rel='noopener noreferrer'
        target='_blank'
      >
        {txid}
      </a>
      <p className='mt-2 text-xs text-gray-500'>
        {confirmations !== null
          ? `${confirmations} confirmation${confirmations === 1 ? '' : 's'}`
          : 'Waiting for confirmation...'}
      </p>
      {summary ? (
        <pre className='mt-3 overflow-x-auto rounded bg-white/70 p-3 text-xs'>
          {JSON.stringify(summary, null, 2)}
        </pre>
      ) : null}
    </div>
  )
}

function formatCollateralUtxoOption(utxo: WalletTxOut): UiSelectOption {
  const outpoint = outpointToString(utxo)
  const height = utxo.height()
  const status = height === undefined ? 'mempool' : `height ${height}`
  return {
    id: outpoint,
    label: `${outpoint} | ${utxo.unblinded().value().toString()} sats | ${status}`,
  }
}

function parseOutPoint(value: string): OutPoint {
  return new OutPoint(value)
}

function parseAssetId(value: string): AssetId {
  return AssetId.fromString(value)
}

function parseAddress(value: string, network: Network): Address {
  // Address.parse currently rejects explicit tex1... addresses in lwk_wasm.
  // TxBuilder still needs explicit addresses for addExplicitRecipient, so use
  // the constructor here and keep network-specific validation at call sites.
  void network
  return new Address(value)
}

async function buildExplicitExternalUtxo(
  outpointString: string,
  assetIdString: string,
  amount: bigint,
  label: string,
): Promise<ExternalUtxo> {
  const outpoint = parseOutPoint(outpointString)
  const tx = Transaction.fromBytes(await fetchTxRaw(outpoint.txid().toString()))
  const txOut = tx.outputs[outpoint.vout()]
  if (!txOut) {
    throw new Error(`${label} transaction does not have the selected output`)
  }

  return new ExternalUtxo(
    outpoint.vout(),
    tx,
    TxOutSecrets.fromExplicit(parseAssetId(assetIdString), amount),
    DEFAULT_EXTERNAL_UTXO_MAX_WEIGHT_TO_SATISFY,
    true,
  )
}

function parseCreateOfferForm(form: CreateOfferForm): ParsedCreateOfferForm {
  const result = createOfferFormSchema.safeParse(form)
  if (!result.success) {
    throw new Error(result.error.issues.map(issue => issue.message).join('; '))
  }
  return result.data
}

function requireWalletUtxo(
  walletUtxos: WalletTxOut[],
  outpoint: string,
  label: string,
): WalletTxOut {
  const utxo = findUtxoByOutpoint(walletUtxos, outpoint.trim())
  if (!utxo) {
    throw new Error(`${label} wallet UTXO not found`)
  }
  return utxo
}

function assertWalletUtxoAssetAndAmount(
  utxo: WalletTxOut,
  assetId: string,
  minAmount: bigint,
  label: string,
) {
  const unblinded = utxo.unblinded()
  if (unblinded.asset().toString() !== assetId) {
    throw new Error(`${label} UTXO has unexpected asset ${unblinded.asset().toString()}`)
  }
  if (unblinded.value() < minAmount) {
    throw new Error(`${label} UTXO amount is lower than ${minAmount.toString()}`)
  }
}

function emptyContractHash(): ContractHash {
  return ContractHash.fromBytes(new Uint8Array(32))
}
