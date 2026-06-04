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
  type XOnlyPublicKey,
} from 'lwk_web'
import { useCallback, useEffect, useMemo, useState } from 'react'

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

interface CreateOfferForm {
  factoryAuthOutpoint: string
  issuanceFactoryOutpoint: string
  factoryAssetId: string
  collateralOutpoint: string
  collateralAmount: string
  principalAssetId: string
  principalAmount: string
  principalInterestRate: string
  loanDurationBlocks: string
  protocolFeeKeeperAssetId: string
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
  factoryAuthOutpoint: '5ecc77af31963bfef85418a2b196fc274626b1e0094eb280d37a908f0171a13a:0',
  issuanceFactoryOutpoint: '5ecc77af31963bfef85418a2b196fc274626b1e0094eb280d37a908f0171a13a:1',
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
  const [form, setForm] = useState<CreateOfferForm>(EMPTY_FORM)
  const [xOnlyPublicKey, setXOnlyPublicKey] = useState<XOnlyPublicKey | null>(null)
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
    void refreshWalletUtxos()
  }, [refreshWalletUtxos])

  const setField = (field: keyof CreateOfferForm, value: string) => {
    setForm(current => ({ ...current, [field]: value }))
  }

  const createOffer = async () => {
    setState(current => ({ ...current, busy: true, error: null, summary: null, txid: null }))

    let createStage = 'initializing'
    try {
      createStage = 'get x-only public key'
      const key = await getXOnlyPublicKey()
      if (!key) {
        throw new Error('Missing x-only public key')
      }
      setXOnlyPublicKey(key)

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
      logWalletUtxoLookup(walletUtxos, [
        { label: 'FactoryAuth', outpoint: form.factoryAuthOutpoint },
        { label: 'Collateral', outpoint: form.collateralOutpoint },
      ])
      const factoryAuthUtxo = findUtxoByOutpoint(walletUtxos, form.factoryAuthOutpoint.trim())
      const collateralUtxo = requireWalletUtxo(walletUtxos, form.collateralOutpoint, 'Collateral')

      createStage = 'parse and validate form'
      const factoryAsset = parseAssetId(form.factoryAssetId, 'Factory asset id')
      const principalAsset = parseAssetId(form.principalAssetId, 'Principal asset id')
      const protocolFeeKeeperAsset = parseAssetId(
        form.protocolFeeKeeperAssetId,
        'Protocol fee keeper asset id',
      )
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
      } else {
        console.info('[CreateOfferDemo] FactoryAuth not in wallet UTXO set; using external UTXO', {
          outpoint: form.factoryAuthOutpoint.trim(),
          asset: factoryAssetString,
          amount: NFT_AMOUNT.toString(),
        })
      }
      assertWalletUtxoAssetAndAmount(
        collateralUtxo,
        policyAssetString,
        parseBigint(form.collateralAmount, 'Collateral amount'),
        'Collateral',
      )

      const factoryAuthOutpointString = form.factoryAuthOutpoint.trim()
      const issuanceFactoryOutpointString = form.issuanceFactoryOutpoint.trim()
      const collateralOutpointString = form.collateralOutpoint.trim()
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
      const issuanceFactoryScriptPubkeyHex = bytesToHex(
        issuanceFactoryAddress.scriptPubkey().bytes(),
      )

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
        TxOutSecrets.fromExplicit(parseAssetId(factoryAssetString, 'Factory asset id'), NFT_AMOUNT),
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
      const loanDurationBlocks = parseNumber(form.loanDurationBlocks, 'Loan duration blocks')
      const offerParameters = {
        collateralAmount: parseBigint(form.collateralAmount, 'Collateral amount'),
        principalAmount: parseBigint(form.principalAmount, 'Principal amount'),
        principalInterestRate: parseNumber(form.principalInterestRate, 'Interest rate bps'),
        loanExpirationTime: currentBlockHeight + loanDurationBlocks,
      }

      createStage = 'compile lending and ScriptAuth programs'
      const derivedLendingParams = buildDerivedLendingOfferProgramParams(
        {
          collateralAssetId: parseAssetId(policyAssetString, 'Policy asset id').toBytes(),
          principalAssetId: parseAssetId(principalAssetString, 'Principal asset id').toBytes(),
          borrowerNftAssetId: parseAssetId(
            borrowerNftAssetString,
            'Borrower NFT asset id',
          ).toBytes(),
          lenderNftAssetId: parseAssetId(lenderNftAssetString, 'Lender NFT asset id').toBytes(),
          protocolFeeKeeperAssetId: parseAssetId(
            protocolFeeKeeperAssetString,
            'Protocol fee keeper asset id',
          ).toBytes(),
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
        principalAssetId: parseAssetId(principalAssetString, 'Principal asset id').toBytes(),
        offerParameters,
      })

      logAddressShape('receive explicit', receiveAddressExplicitString)
      logAddressShape('receive confidential', receiveAddressString)
      logAddressShape('issuanceFactory covenant', issuanceFactoryAddressString)
      logAddressShape('lender NFT ScriptAuth', lenderNftScriptAuthAddressString)

      createStage = 'TxBuilder.new'
      console.info('[CreateOfferDemo] stage', createStage)
      let txBuilder = new TxBuilder(lwkNetwork)

      createStage = 'TxBuilder.feeRate'
      console.info('[CreateOfferDemo] stage', createStage, { feeRate: DEFAULT_FEE_RATE })
      txBuilder = txBuilder.feeRate(DEFAULT_FEE_RATE)

      createStage = 'TxBuilder.setInputOrder'
      console.info('[CreateOfferDemo] stage', createStage, {
        inputOrder: [
          factoryAuthOutpointString,
          issuanceFactoryOutpointString,
          collateralOutpointString,
        ],
      })
      txBuilder = txBuilder.setInputOrder([
        parseOutPoint(factoryAuthOutpointString),
        parseOutPoint(issuanceFactoryOutpointString),
        parseOutPoint(collateralOutpointString),
      ])

      const externalUtxos = factoryAuthExternalUtxo
        ? [factoryAuthExternalUtxo, issuanceFactoryExternalUtxo]
        : [issuanceFactoryExternalUtxo]

      createStage = 'TxBuilder.addExternalUtxos covenant/explicit inputs'
      console.info('[CreateOfferDemo] stage', createStage, {
        externalOutpoints: factoryAuthExternalUtxo
          ? [factoryAuthOutpointString, issuanceFactoryOutpointString]
          : [issuanceFactoryOutpointString],
      })
      txBuilder = txBuilder.addExternalUtxos(externalUtxos)

      createStage = 'TxBuilder.addExplicitRecipient FactoryAuth back to user'
      console.info('[CreateOfferDemo] stage', createStage, {
        address: receiveAddressExplicitString,
        asset: factoryAssetString,
        amount: NFT_AMOUNT.toString(),
      })
      txBuilder = txBuilder.addExplicitRecipient(
        parseAddress(receiveAddressExplicitString, lwkNetwork),
        NFT_AMOUNT,
        parseAssetId(factoryAssetString, 'Factory asset id'),
      )

      createStage = 'TxBuilder.addExplicitScriptOutput IssuanceFactory covenant'
      console.info('[CreateOfferDemo] stage', createStage, {
        scriptPubkeyHex: issuanceFactoryScriptPubkeyHex,
        asset: factoryAssetString,
        amount: NFT_AMOUNT.toString(),
      })
      txBuilder = txBuilder.addExplicitScriptOutput(
        new Script(issuanceFactoryScriptPubkeyHex),
        NFT_AMOUNT,
        parseAssetId(factoryAssetString, 'Factory asset id'),
      )

      createStage = 'TxBuilder.issueAssetToRecipients Borrower NFT to user'
      console.info('[CreateOfferDemo] stage', createStage, {
        inputOutpoint: issuanceFactoryOutpointString,
        address: receiveAddressExplicitString,
        amount: NFT_AMOUNT.toString(),
      })
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
      console.info('[CreateOfferDemo] stage', createStage, {
        inputOutpoint: collateralOutpointString,
        address: lenderNftScriptAuthAddressString,
        amount: NFT_AMOUNT.toString(),
      })
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
      console.info('[CreateOfferDemo] stage', createStage, {
        asset: policyAssetString,
        metadataHex: bytesToHex(metadata),
      })
      txBuilder = txBuilder.addExplicitScriptOutput(
        Script.newOpReturn(metadata),
        0n,
        parseAssetId(policyAssetString, 'Policy asset id'),
      )

      createStage = 'TxBuilder.addExplicitScriptOutput Lending covenant collateral'
      console.info('[CreateOfferDemo] stage', createStage, {
        scriptPubkeyHex: lendingScriptPubkeyHex,
        asset: policyAssetString,
        amount: offerParameters.collateralAmount.toString(),
      })
      txBuilder = txBuilder.addExplicitScriptOutput(
        new Script(lendingScriptPubkeyHex),
        offerParameters.collateralAmount,
        parseAssetId(policyAssetString, 'Policy asset id'),
      )

      createStage = 'TxBuilder.finish'
      console.info('[CreateOfferDemo] stage', createStage)
      const pset = txBuilder.finish(wollet)

      console.log(
        pset.outputs().map((output, index) => ({
          index,
          asset: output.asset()?.toString?.(),
          amount: output.amount()?.toString?.(),
        })),
      )

      createStage = 'sign offer PSET'
      const signedPset = await signPset(pset)
      createStage = 'finalize wallet inputs'
      console.log('[CreateOfferDemo] finalize params', {
        currentIndex: 1,
        prevOutputs: [
          factoryAuthOutpointString,
          issuanceFactoryOutpointString,
          collateralOutpointString,
        ],
      })
      const finalizedWalletPset = wollet.finalize(signedPset)
      const txWithWalletWitnesses = finalizedWalletPset.extractTx()

      console.log(
        txWithWalletWitnesses.outputs.map((output, index) => ({
          index,
          script: bytesToHex(output.scriptPubkey().bytes()),
          isOpReturn: bytesToHex(output.scriptPubkey().bytes()).startsWith('6a'),
        })),
      )

      console.table(
        txWithWalletWitnesses.outputs.map((output, index) => ({
          index,
          scriptHash: output.scriptPubkey().jet_sha256_hex(),
          script: bytesToHex(output.scriptPubkey().bytes()),
        })),
      )

      console.table(
        txWithWalletWitnesses.inputs.map((input, index) => ({
          index,
          outpoint: input.outpoint().toString(),
        })),
      )

      console.log(txWithWalletWitnesses.inputs)

      console.table(
        txWithWalletWitnesses.inputs.map((input, index) => ({
          index,
          outpoint: input.outpoint().toString(),
        })),
      )

      console.log(txWithWalletWitnesses.toString())

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

      console.log('factory txout script hash', issuanceFactoryTxOut.scriptPubkey().jet_sha256_hex())

      console.log(
        'output 4 script hash',
        txWithWalletWitnesses.outputs[4]?.scriptPubkey().jet_sha256_hex(),
      )

      console.log('EXPECTED', {
        factoryAssetId: factoryAssetString,
        borrowerNftAssetId: borrowerNftAssetString,
        lenderNftAssetId: lenderNftAssetString,
      })

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

      const witness = buildIssuanceFactoryWitness({
        branch: 'IssueAssets',
        outputIndex: 0,
      })

      console.log('ISSUANCE FACTORY SCRIPT', issuanceFactoryScriptPubkeyHex)
      console.log('SCRIPT AUTH SCRIPT', lenderNftScriptAuthAddress.scriptPubkey().toString())
      console.log('LENDING SCRIPT', lendingScriptPubkeyHex)

      console.log('[CreateOfferDemo] IssuanceFactory witness', witness)

      createStage = 'broadcast transaction'
      const txid = await broadcastTx(finalizedTx.toString())

      setState({
        busy: false,
        error: null,
        summary: {
          inputs: {
            '0 FactoryAuth': form.factoryAuthOutpoint,
            '1 IssuanceFactory covenant': form.issuanceFactoryOutpoint,
            '2 Collateral LBTC': form.collateralOutpoint,
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
      console.error('[CreateOfferDemo] create failed', { createStage, err })
      setState(current => ({
        ...current,
        busy: false,
        error: `${createStage}: ${errorMessage}`,
      }))
    }
  }

  return (
    <div className='rounded border border-gray-300 bg-white p-4'>
      <div className='font-bold'>Create Offer Demo</div>
      <p className='mt-2 max-w-3xl text-sm text-gray-600'>
        Builds one offer creation transaction: FactoryAuth input, IssuanceFactory covenant input,
        and LBTC collateral input. Borrower account UTXOs are entered manually.
      </p>

      <div className='mt-4 grid gap-3 md:grid-cols-2'>
        <UiTextField
          label='FactoryAuth outpoint'
          placeholder='txid:0'
          value={form.factoryAuthOutpoint}
          onChange={value => setField('factoryAuthOutpoint', value)}
          description='Manual fallback for explicit wallet UTXOs that LWK scan does not list'
        />
        <UiTextField
          label='IssuanceFactory covenant outpoint'
          placeholder='txid:1'
          value={form.issuanceFactoryOutpoint}
          onChange={value => setField('issuanceFactoryOutpoint', value)}
        />
        <UiTextField
          label='Factory asset id'
          placeholder='64 hex chars'
          value={form.factoryAssetId}
          onChange={value => setField('factoryAssetId', value)}
        />
        <UiSelect
          label='Collateral LBTC outpoint'
          placeholder='Select wallet LBTC UTXO'
          options={collateralUtxoOptions}
          selectedKey={form.collateralOutpoint || null}
          onSelectionChange={key => setField('collateralOutpoint', key ? String(key) : '')}
          description={
            collateralUtxoOptions.length
              ? `${collateralUtxoOptions.length} wallet LBTC UTXO(s)`
              : 'No wallet LBTC UTXOs loaded'
          }
        />
        <UiTextField
          label='Collateral amount'
          value={form.collateralAmount}
          onChange={value => setField('collateralAmount', value)}
        />
        <UiTextField
          label='Principal amount'
          value={form.principalAmount}
          onChange={value => setField('principalAmount', value)}
        />
        <UiTextField
          label='Principal asset id'
          value={form.principalAssetId}
          onChange={value => setField('principalAssetId', value)}
        />
        <UiTextField
          label='Protocol fee keeper asset id'
          value={form.protocolFeeKeeperAssetId}
          onChange={value => setField('protocolFeeKeeperAssetId', value)}
        />
        <UiTextField
          label='Interest rate bps'
          value={form.principalInterestRate}
          onChange={value => setField('principalInterestRate', value)}
        />
        <UiTextField
          label='Loan duration blocks'
          value={form.loanDurationBlocks}
          onChange={value => setField('loanDurationBlocks', value)}
        />
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
        <UiButton isPending={state.busy} loadingText='Creating offer...' onPress={createOffer}>
          Create Offer
        </UiButton>
      </div>

      {state.error ? <p className='mt-3 text-xs text-red-500'>Create: {state.error}</p> : null}

      <BroadcastResult txid={state.txid} confirmations={confirmations} summary={state.summary} />

      <pre className='mt-4 overflow-x-auto rounded bg-gray-100 p-4 text-sm'>
        {JSON.stringify(
          {
            connectionStatus,
            hasPubkey: !!xOnlyPublicKey,
            broadcasting: state.busy,
            txid: state.txid,
            confirmations,
            error: state.error,
          },
          null,
          2,
        )}
      </pre>
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

function logWalletUtxoLookup(
  walletUtxos: WalletTxOut[],
  targets: { label: string; outpoint: string }[],
) {
  console.group('[CreateOfferDemo] wallet UTXO lookup')
  console.table(
    targets.map(target => ({
      label: target.label,
      rawOutpoint: target.outpoint,
      trimmedOutpoint: target.outpoint.trim(),
      existsInWallet: Boolean(findUtxoByOutpoint(walletUtxos, target.outpoint.trim())),
    })),
  )
  console.table(
    walletUtxos.map(utxo => ({
      outpoint: outpointToString(utxo),
      asset: utxo.unblinded().asset().toString(),
      amount: utxo.unblinded().value().toString(),
      height: utxo.height() ?? 'mempool',
      address: utxo.address().toString(),
    })),
  )
  console.groupEnd()
}

function logAddressShape(label: string, addressString: string) {
  try {
    const address = new Address(addressString)
    console.info('[CreateOfferDemo] address shape', {
      label,
      address: addressString,
      isBlinded: address.isBlinded(),
      isMainnet: address.isMainnet(),
    })
  } catch (err) {
    console.info('[CreateOfferDemo] address shape parse failed', {
      label,
      address: addressString,
      err,
    })
  }
}

function parseOutPoint(value: string): OutPoint {
  const trimmed = value.trim()
  if (!/^[0-9a-fA-F]{64}:\d+$/.test(trimmed)) {
    throw new Error(`Invalid outpoint: ${value}`)
  }
  return new OutPoint(trimmed)
}

function parseAssetId(value: string, label: string): AssetId {
  const normalized = normalizeHex(value)
  if (!isHexStringOfByteLength(normalized, 32)) {
    throw new Error(`${label} must be a 32-byte hex asset id`)
  }
  return AssetId.fromString(normalized)
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
    TxOutSecrets.fromExplicit(parseAssetId(assetIdString, `${label} asset id`), amount),
    DEFAULT_EXTERNAL_UTXO_MAX_WEIGHT_TO_SATISFY,
    true,
  )
}

function parseBigint(value: string, label: string): bigint {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${label} must be an integer`)
  }
  return BigInt(trimmed)
}

function parseNumber(value: string, label: string): number {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${label} must be an integer`)
  }
  return Number.parseInt(trimmed, 10)
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
