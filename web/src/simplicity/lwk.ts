/**
 * LWK (Liquid Wallet Kit) integration for Simplicity programs.
 * - Initializes Wallet ABI core wasm once, exposes program creation and P2TR address helpers.
 */

import { loadLwkWalletAbiWeb } from 'helpers_wallet_abi_web'

export type P2pkNetwork = 'mainnet' | 'testnet'

export interface LwkAddress {
  scriptPubkey(): LwkScript | null | undefined
  toUnconfidential(): LwkAddress
  toString(): string
}

export interface LwkAssetId {
  toString(): string
}

export type LwkContractHash = object

export type LwkLockTime = object

export type LwkOutPoint = object

export interface LwkScript {
  bytes(): Uint8Array
  toString(): string
}

export interface LwkSimplicityArguments {
  addValue(name: string, value: LwkSimplicityTypedValue): LwkSimplicityArguments
  free(): void
  [Symbol.dispose](): void
}

export interface LwkSimplicityProgram {
  createP2trAddress(internalKey: LwkXOnlyPublicKey, network: LwkNetwork): LwkAddress
  getSighashAll(
    tx: LwkTransaction,
    internalKey: LwkXOnlyPublicKey,
    prevouts: LwkTxOutArray,
    inputIndex: number,
    network: LwkNetwork
  ): string
  finalizeTransaction(
    tx: LwkTransaction,
    internalKey: LwkXOnlyPublicKey,
    prevouts: LwkTxOutArray,
    inputIndex: number,
    witnessValues: LwkSimplicityWitnessValues,
    network: LwkNetwork,
    logLevel: number
  ): LwkTransaction
}

export type LwkSimplicityType = object

export type LwkSimplicityTypedValue = object

export interface LwkSimplicityWitnessValues {
  addValue(name: string, value: LwkSimplicityTypedValue): LwkSimplicityWitnessValues
  free(): void
  [Symbol.dispose](): void
}

export interface LwkTxSequence {
  toConsensusU32?(): number
  to_consensus_u32?(): number
}

export interface LwkTxOut {
  asset(): LwkAssetId | undefined
  value(): bigint | undefined
  scriptPubkey(): LwkScript
}

/** Array of LWK TxOut (e.g. for getSighashAll / finalizeTransaction prevouts). */
export type LwkTxOutArray = LwkTxOut[]

export type LwkTxid = object

export interface LwkXOnlyPublicKey {
  toHex(): string
}

export interface LwkKeypair {
  xOnlyPublicKey(): LwkXOnlyPublicKey
  signSchnorr(sighashHex: string): string
}

export interface LwkNetwork {
  policyAsset(): LwkAssetId
}

export interface LwkTransaction {
  toString(): string
  readonly outputs: LwkTxOut[]
}

interface LwkPsetBuilderInstance {
  addInput(input: unknown): LwkPsetBuilderInstance
  addOutput(output: unknown): LwkPsetBuilderInstance
  setFallbackLocktime(lockTime: LwkLockTime): LwkPsetBuilderInstance
  build(): unknown
}

interface LwkPsetInputBuilderInstance {
  witnessUtxo(txOut: LwkTxOut): LwkPsetInputBuilderInstance
  sequence(sequence: LwkTxSequence): LwkPsetInputBuilderInstance
  issuanceValueAmount(amount: bigint): LwkPsetInputBuilderInstance
  issuanceAssetEntropy(contractHash: LwkContractHash): LwkPsetInputBuilderInstance
  blindedIssuance(value: boolean): LwkPsetInputBuilderInstance
  build(): unknown
}

interface LwkPsetOutputBuilderInstance {
  build(): unknown
}

/** LWK module (return type of getLwk()). Use for typing lwk argument across the app. */
export interface Lwk {
  Address: {
    new (address: string): LwkAddress
  }
  AssetId: {
    new (assetIdHex: string): LwkAssetId
  }
  ContractHash: {
    fromBytes(bytes: Uint8Array): LwkContractHash
  }
  Keypair: {
    new (secretKey: Uint8Array): LwkKeypair
  }
  LockTime: {
    from_height(height: number): LwkLockTime
  }
  Network: {
    mainnet(): LwkNetwork
    testnet(): LwkNetwork
  }
  OutPoint: {
    fromParts(txid: LwkTxid, vout: number): LwkOutPoint
  }
  PsetBuilder: {
    newV2(): LwkPsetBuilderInstance
  }
  PsetInputBuilder: {
    fromPrevout(outpoint: LwkOutPoint): LwkPsetInputBuilderInstance
  }
  PsetOutputBuilder: {
    newExplicit(
      script: LwkScript,
      amount: bigint,
      assetId: LwkAssetId
    ): LwkPsetOutputBuilderInstance
  }
  Script: {
    new (scriptHex: string): LwkScript
    empty(): LwkScript
  }
  SimplicityArguments: {
    new (): LwkSimplicityArguments
  }
  SimplicityLogLevel: {
    None: number
  }
  SimplicityProgram: {
    load(source: string, args: LwkSimplicityArguments): LwkSimplicityProgram
  }
  SimplicityType: {
    fromString(typeString: string): LwkSimplicityType
  }
  SimplicityTypedValue: {
    fromBoolean(value: boolean): LwkSimplicityTypedValue
    fromByteArrayHex(value: string): LwkSimplicityTypedValue
    fromU16(value: number): LwkSimplicityTypedValue
    fromU32(value: number): LwkSimplicityTypedValue
    fromU64(value: bigint): LwkSimplicityTypedValue
    fromU256Hex(value: string): LwkSimplicityTypedValue
    parse(value: string, type: LwkSimplicityType): LwkSimplicityTypedValue
  }
  SimplicityWitnessValues: {
    new (): LwkSimplicityWitnessValues
  }
  Transaction: {
    fromString(txHex: string): LwkTransaction
  }
  TxId?: unknown
  TxOut: {
    fromExplicit(script: LwkScript, assetId: LwkAssetId, value: bigint): LwkTxOut
  }
  TxSequence: {
    enableLocktimeNoRbf?(): LwkTxSequence
    enable_locktime_no_rbf?(): LwkTxSequence
  }
  Txid: {
    new (txidHex: string): LwkTxid
  }
  XOnlyPublicKey: {
    fromBytes(bytes: Uint8Array): LwkXOnlyPublicKey
  }
  assetIdFromIssuance(outpoint: LwkOutPoint, contractHash: LwkContractHash): LwkAssetId
}

let lwkInit: Promise<Lwk> | null = null

export async function getLwk(): Promise<Lwk> {
  if (!lwkInit) {
    lwkInit = (async () => {
      await loadLwkWalletAbiWeb()
      return (await import('wallet_abi_sdk_core_web')) as unknown as Lwk
    })()
  }
  return lwkInit
}

/** PSET that can yield the unsigned transaction for LWK signing (extractTx). */
export interface PsetWithExtractTx {
  extractTx(): LwkTransaction
}

export interface CreateP2trAddressParams {
  source: string
  args: LwkSimplicityArguments
  internalKey: LwkXOnlyPublicKey
  network: P2pkNetwork
}

/**
 * Compile a Simplicity program from source + arguments and create its P2TR address.
 */
export async function createP2trAddress(params: CreateP2trAddressParams): Promise<string> {
  const lwk = await getLwk()
  const { SimplicityProgram, Network } = lwk
  const program = SimplicityProgram.load(params.source, params.args)
  const net = params.network === 'mainnet' ? Network.mainnet() : Network.testnet()
  const address = program.createP2trAddress(params.internalKey, net)
  return address.toString()
}
