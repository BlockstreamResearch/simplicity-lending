import {
  LockTime,
  OutPoint,
  TxSequence,
  WalletAbiAmountFilter,
  WalletAbiAssetFilter,
  WalletAbiAssetVariant,
  WalletAbiBlinderVariant,
  WalletAbiFinalizerSpec,
  WalletAbiInputIssuance,
  WalletAbiInputSchema,
  WalletAbiInputUnblinding,
  WalletAbiLockFilter,
  WalletAbiLockVariant,
  WalletAbiOutputSchema,
  WalletAbiRuntimeParams,
  WalletAbiTxCreateRequest,
  WalletAbiWalletSourceFilter,
  assetIdFromString,
  createProvidedInput,
  createTxCreateRequest,
  createWalletInput,
  networkFromString,
  walletAbiNetworkToLwkNetworkName,
  type AssetId,
} from 'lwk_wallet_abi_sdk'
import { getWalletAbiTransportNetwork } from '../config/runtimeConfig'

const APP_NETWORK = networkFromString(
  walletAbiNetworkToLwkNetworkName(getWalletAbiTransportNetwork())
)
const DEFAULT_FEE_RATE_SAT_KVB = 100.0
const DEFAULT_SEQUENCE = TxSequence.enableLocktimeNoRbf()

function normalizeAssetIdHex(value: string): string {
  return value.trim().toLowerCase().replace(/^0x/, '')
}

export function walletAbiNetwork() {
  return APP_NETWORK
}

export function walletAbiPolicyAsset(): AssetId {
  return APP_NETWORK.policyAsset()
}

export function walletAbiAssetId(assetIdHex: string): AssetId {
  return assetIdFromString(normalizeAssetIdHex(assetIdHex))
}

export function walletAbiOutPoint(txid: string, vout: number): OutPoint {
  return new OutPoint(`${txid.trim()}:${String(vout)}`)
}

export function walletAbiWalletFilter(params?: {
  assetIdHex?: string | null
  exactAmount?: bigint | null
  minAmount?: bigint | null
}) {
  return WalletAbiWalletSourceFilter.withFilters(
    params?.assetIdHex
      ? WalletAbiAssetFilter.exact(walletAbiAssetId(params.assetIdHex))
      : WalletAbiAssetFilter.none(),
    params?.exactAmount != null
      ? WalletAbiAmountFilter.exact(params.exactAmount)
      : params?.minAmount != null
        ? WalletAbiAmountFilter.min(params.minAmount)
        : WalletAbiAmountFilter.none(),
    WalletAbiLockFilter.none()
  )
}

export class WalletAbiRequestBuilder {
  private inputs: WalletAbiInputSchema[] = []
  private outputs: WalletAbiOutputSchema[] = []
  private lockTime: LockTime | null = null

  rawInputSchema(schema: WalletAbiInputSchema) {
    this.inputs.push(schema)
    return this
  }

  walletInputExact(id: string, assetIdHex: string, amountSat: bigint) {
    this.inputs.push(
      createWalletInput({
        id,
        filter: walletAbiWalletFilter({ assetIdHex, exactAmount: amountSat }),
        sequence: DEFAULT_SEQUENCE,
      })
    )
    return this
  }

  walletInputByFilter(
    id: string,
    filter: ReturnType<typeof walletAbiWalletFilter>,
    sequence: TxSequence = DEFAULT_SEQUENCE
  ) {
    this.inputs.push(
      createWalletInput({
        id,
        filter,
        sequence,
      })
    )
    return this
  }

  providedInput(
    id: string,
    outpoint: OutPoint,
    finalizer: WalletAbiFinalizerSpec,
    unblinding: WalletAbiInputUnblinding = WalletAbiInputUnblinding.explicit()
  ) {
    this.inputs.push(
      createProvidedInput({
        id,
        outpoint,
        unblinding,
        sequence: DEFAULT_SEQUENCE,
        finalizer,
      })
    )
    return this
  }

  newIssuance(inputId: string, assetAmountSat: bigint, tokenAmountSat: bigint, entropy: Uint8Array) {
    const inputIndex = this.inputs.findIndex((input) => input.id() === inputId)
    if (inputIndex === -1) {
      throw new Error(`Missing input '${inputId}' for issuance.`)
    }

    this.inputs[inputIndex] = this.inputs[inputIndex]!.withIssuance(
      WalletAbiInputIssuance.new(assetAmountSat, tokenAmountSat, entropy)
    )

    return this
  }

  explicitOutput(id: string, script: Parameters<typeof WalletAbiLockVariant.script>[0], assetIdHex: string, amountSat: bigint) {
    this.outputs.push(
      WalletAbiOutputSchema.new(
        id,
        amountSat,
        WalletAbiLockVariant.script(script),
        WalletAbiAssetVariant.assetId(walletAbiAssetId(assetIdHex)),
        WalletAbiBlinderVariant.explicit()
      )
    )
    return this
  }

  finalizerOutput(
    id: string,
    finalizer: WalletAbiFinalizerSpec,
    assetIdHex: string,
    amountSat: bigint
  ) {
    this.outputs.push(
      WalletAbiOutputSchema.new(
        id,
        amountSat,
        WalletAbiLockVariant.finalizer(finalizer),
        WalletAbiAssetVariant.assetId(walletAbiAssetId(assetIdHex)),
        WalletAbiBlinderVariant.explicit()
      )
    )
    return this
  }

  rawOutput(
    id: string,
    lock: WalletAbiLockVariant,
    assetIdHex: string,
    amountSat: bigint
  ) {
    this.outputs.push(
      WalletAbiOutputSchema.new(
        id,
        amountSat,
        lock,
        WalletAbiAssetVariant.assetId(walletAbiAssetId(assetIdHex)),
        WalletAbiBlinderVariant.explicit()
      )
    )
    return this
  }

  newIssuanceAssetOutput(
    id: string,
    script: Parameters<typeof WalletAbiLockVariant.script>[0],
    inputIndex: number,
    amountSat: bigint
  ) {
    this.outputs.push(
      WalletAbiOutputSchema.new(
        id,
        amountSat,
        WalletAbiLockVariant.script(script),
        WalletAbiAssetVariant.newIssuanceAsset(inputIndex),
        WalletAbiBlinderVariant.explicit()
      )
    )
    return this
  }

  lockTimeHeight(height: number) {
    this.lockTime = LockTime.from_height(height)
    return this
  }

  buildCreate(): WalletAbiTxCreateRequest {
    return createTxCreateRequest({
      network: APP_NETWORK,
      params: WalletAbiRuntimeParams.new(
        this.inputs,
        this.outputs,
        DEFAULT_FEE_RATE_SAT_KVB,
        this.lockTime
      ),
      broadcast: true,
    })
  }
}
