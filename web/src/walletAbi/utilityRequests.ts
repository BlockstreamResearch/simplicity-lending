import {
  createExplicitAsset,
  createExplicitBlinder,
  createNewIssuanceAsset,
  createNewIssuanceToken,
  createOutput,
  createReIssuanceAsset,
  createRuntimeParams,
  createScriptLock,
  createTxCreateRequest,
  createWalletInput,
  deriveAssetIdFromIssuance,
  deriveReissuanceTokenFromIssuance,
  generateIssuanceAssetEntropy,
} from 'wallet-abi-sdk-alpha'
import type { TxCreateRequest, WalletAbiNetwork } from 'wallet-abi-sdk-alpha/schema'
import { getLwk } from '../simplicity/lwk'
import { bytesToHex, hexToBytes, normalizeHex } from '../utility/hex'
import { POLICY_ASSET_ID, walletAbiNetworkToP2pkNetwork } from '../utility/addressP2pk'

export interface DemoIssueAssetRequestResult {
  request: TxCreateRequest
  contractHash: string
}

export interface DerivedDemoIssuedAsset {
  assetId: string
  reissuanceTokenId: string
  assetEntropy: string
  contractHash: string
  issuancePrevout: string
}

const DEMO_REISSUANCE_TOKEN_AMOUNT_SAT = 1

function toAmountSat(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`)
  }
  return value
}

function normalizeAssetId(assetId: string, label: string): string {
  const normalized = normalizeHex(assetId)
  if (normalized.length !== 64) {
    throw new Error(`${label} must be 64 hex characters`)
  }
  return normalized
}

function normalizeEntropyHex(value: string, label: string): string {
  const normalized = normalizeHex(value)
  if (normalized.length !== 64) {
    throw new Error(`${label} must be 32 bytes of hex`)
  }
  return normalized
}

function normalizeScriptHex(scriptHex: string, label: string): string {
  const normalized = normalizeHex(scriptHex)
  if (normalized.length === 0 || normalized.length % 2 !== 0) {
    throw new Error(`${label} must be non-empty hex`)
  }
  return normalized
}

function policyAssetIdForNetwork(network: WalletAbiNetwork): string {
  return POLICY_ASSET_ID[walletAbiNetworkToP2pkNetwork(network)]
}

function randomContractHash(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return bytesToHex(bytes)
}

function buildRequest(
  network: WalletAbiNetwork,
  params: Parameters<typeof createRuntimeParams>[0],
): TxCreateRequest {
  return createTxCreateRequest({
    network,
    broadcast: true,
    params: createRuntimeParams(params),
  })
}

export function buildDemoTransferRequest(params: {
  network: WalletAbiNetwork
  recipientScriptPubkeyHex: string
  assetId?: string
  amountSat: number
}): TxCreateRequest {
  const assetId = normalizeAssetId(
    params.assetId ?? policyAssetIdForNetwork(params.network),
    'Transfer asset',
  )
  const amountSat = toAmountSat(params.amountSat, 'Transfer amount')
  const recipientScript = normalizeScriptHex(
    params.recipientScriptPubkeyHex,
    'Transfer destination script',
  )

  return buildRequest(params.network, {
    inputs: [
      createWalletInput({
        id: 'transfer-input',
        filter: {
          asset: {
            exact: {
              asset_id: assetId,
            },
          },
        },
      }),
    ],
    outputs: [
      createOutput({
        id: 'transfer-output',
        amount_sat: amountSat,
        lock: createScriptLock(recipientScript),
        asset: createExplicitAsset(assetId),
        blinder: createExplicitBlinder(),
      }),
    ],
  })
}

export function buildDemoSplitRequest(params: {
  network: WalletAbiNetwork
  destinationScriptPubkeyHex: string
  assetId?: string
  splitParts: number
  partAmountSat: number
}): TxCreateRequest {
  const assetId = normalizeAssetId(
    params.assetId ?? policyAssetIdForNetwork(params.network),
    'Split asset',
  )
  const splitParts = toAmountSat(params.splitParts, 'Split parts')
  const partAmountSat = toAmountSat(params.partAmountSat, 'Split part amount')
  const destinationScript = normalizeScriptHex(
    params.destinationScriptPubkeyHex,
    'Split destination script',
  )

  return buildRequest(params.network, {
    inputs: [
      createWalletInput({
        id: 'split-input',
        filter: {
          asset: {
            exact: {
              asset_id: assetId,
            },
          },
        },
      }),
    ],
    outputs: Array.from({ length: splitParts }, (_, index) =>
      createOutput({
        id: `split-output-${index}`,
        amount_sat: partAmountSat,
        lock: createScriptLock(destinationScript),
        asset: createExplicitAsset(assetId),
        blinder: createExplicitBlinder(),
      }),
    ),
  })
}

export function buildDemoIssueAssetRequest(params: {
  network: WalletAbiNetwork
  destinationScriptPubkeyHex: string
  issueAmountSat: number
}): DemoIssueAssetRequestResult {
  const issueAmountSat = toAmountSat(params.issueAmountSat, 'Issue amount')
  const policyAssetId = policyAssetIdForNetwork(params.network)
  const destinationScript = normalizeScriptHex(
    params.destinationScriptPubkeyHex,
    'Issue destination script',
  )
  const contractHash = randomContractHash()

  return {
    contractHash,
    request: buildRequest(params.network, {
      inputs: [
        createWalletInput({
          id: 'issue-input',
          filter: {
            asset: {
              exact: {
                asset_id: policyAssetId,
              },
            },
          },
          issuance: {
            kind: 'new',
            asset_amount_sat: issueAmountSat,
            token_amount_sat: DEMO_REISSUANCE_TOKEN_AMOUNT_SAT,
            entropy: Array.from(hexToBytes(contractHash)),
          },
        }),
      ],
      outputs: [
        createOutput({
          id: 'issue-token-output',
          amount_sat: DEMO_REISSUANCE_TOKEN_AMOUNT_SAT,
          lock: createScriptLock(destinationScript),
          asset: createNewIssuanceToken(0),
          blinder: createExplicitBlinder(),
        }),
        createOutput({
          id: 'issue-asset-output',
          amount_sat: issueAmountSat,
          lock: createScriptLock(destinationScript),
          asset: createNewIssuanceAsset(0),
          blinder: createExplicitBlinder(),
        }),
      ],
    }),
  }
}

export function buildDemoReissueAssetRequest(params: {
  network: WalletAbiNetwork
  destinationScriptPubkeyHex: string
  reissuanceTokenId: string
  assetEntropy: string
  reissueAmountSat: number
}): TxCreateRequest {
  const reissuanceTokenId = normalizeAssetId(
    params.reissuanceTokenId,
    'Reissuance token id',
  )
  const assetEntropy = normalizeEntropyHex(params.assetEntropy, 'Asset entropy')
  const reissueAmountSat = toAmountSat(params.reissueAmountSat, 'Reissue amount')
  const destinationScript = normalizeScriptHex(
    params.destinationScriptPubkeyHex,
    'Reissue destination script',
  )

  return buildRequest(params.network, {
    inputs: [
      createWalletInput({
        id: 'reissue-input',
        filter: {
          asset: {
            exact: {
              asset_id: reissuanceTokenId,
            },
          },
          amount: {
            min: {
              amount_sat: DEMO_REISSUANCE_TOKEN_AMOUNT_SAT,
            },
          },
        },
        issuance: {
          kind: 'reissue',
          asset_amount_sat: reissueAmountSat,
          token_amount_sat: 0,
          entropy: Array.from(hexToBytes(assetEntropy)),
        },
      }),
    ],
    outputs: [
      createOutput({
        id: 'reissue-token-return',
        amount_sat: DEMO_REISSUANCE_TOKEN_AMOUNT_SAT,
        lock: createScriptLock(destinationScript),
        asset: createExplicitAsset(reissuanceTokenId),
        blinder: createExplicitBlinder(),
      }),
      createOutput({
        id: 'reissue-asset-output',
        amount_sat: reissueAmountSat,
        lock: createScriptLock(destinationScript),
        asset: createReIssuanceAsset(0),
        blinder: createExplicitBlinder(),
      }),
    ],
  })
}

export async function deriveDemoIssuedAssetFromTx(input: {
  txHex: string
  contractHash: string
}): Promise<DerivedDemoIssuedAsset> {
  const contractHash = normalizeEntropyHex(input.contractHash, 'Issue contract hash')
  const lwk = await getLwk()
  const transaction = lwk.Transaction.fromString(input.txHex.trim())
  const firstInput = transaction.inputs().at(0)
  if (!firstInput) {
    throw new Error('Issued transaction is missing input[0]')
  }

  const prevout = firstInput.outpoint()
  const issuancePrevout = `${prevout.txid().toString()}:${prevout.vout()}`
  const [assetEntropy, assetId, reissuanceTokenId] = await Promise.all([
    generateIssuanceAssetEntropy({
      outpoint: issuancePrevout,
      contract_hash: contractHash,
    }),
    deriveAssetIdFromIssuance({
      outpoint: issuancePrevout,
      contract_hash: contractHash,
    }),
    deriveReissuanceTokenFromIssuance({
      outpoint: issuancePrevout,
      contract_hash: contractHash,
      is_confidential: false,
    }),
  ])

  return {
    assetId,
    reissuanceTokenId,
    assetEntropy,
    contractHash,
    issuancePrevout,
  }
}
