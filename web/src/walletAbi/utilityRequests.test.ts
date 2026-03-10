import { describe, expect, it } from 'vitest'
import { POLICY_ASSET_ID } from '../utility/addressP2pk'
import {
  buildDemoIssueAssetRequest,
  buildDemoReissueAssetRequest,
  buildDemoSplitRequest,
  buildDemoTransferRequest,
} from './utilityRequests'

const FEE_RATE_SAT_KVB = 432

describe('buildDemoTransferRequest', () => {
  it('uses the policy asset by default and creates one explicit output', () => {
    const request = buildDemoTransferRequest({
      network: 'testnet-liquid',
      feeRateSatKvb: FEE_RATE_SAT_KVB,
      recipientScriptPubkeyHex: '0014' + '11'.repeat(20),
      amountSat: 250,
    })

    expect(request.broadcast).toBe(true)
    expect(request.params.fee_rate_sat_kvb).toBe(FEE_RATE_SAT_KVB)
    expect(request.params.inputs).toHaveLength(1)
    expect(request.params.inputs[0]).toMatchObject({
      id: 'transfer-input',
      utxo_source: {
        wallet: {
          filter: {
            asset: {
              exact: {
                asset_id: POLICY_ASSET_ID.testnet,
              },
            },
          },
        },
      },
    })
    expect(request.params.outputs).toEqual([
      expect.objectContaining({
        id: 'transfer-output',
        amount_sat: 250,
        asset: {
          type: 'asset_id',
          asset_id: POLICY_ASSET_ID.testnet,
        },
        blinder: 'explicit',
      }),
    ])
  })
})

describe('buildDemoSplitRequest', () => {
  it('creates the requested number of explicit outputs', () => {
    const request = buildDemoSplitRequest({
      network: 'localtest-liquid',
      feeRateSatKvb: FEE_RATE_SAT_KVB,
      destinationScriptPubkeyHex: '5120' + '22'.repeat(32),
      assetId: 'ab'.repeat(32),
      splitParts: 3,
      partAmountSat: 125,
    })

    expect(request.params.inputs[0]).toMatchObject({
      id: 'split-input',
      utxo_source: {
        wallet: {
          filter: {
            asset: {
              exact: {
                asset_id: 'ab'.repeat(32),
              },
            },
          },
        },
      },
    })
    expect(request.params.outputs).toHaveLength(3)
    expect(request.params.outputs.map((output) => output.id)).toEqual([
      'split-output-0',
      'split-output-1',
      'split-output-2',
    ])
    expect(request.params.outputs.every((output) => output.amount_sat === 125)).toBe(true)
    expect(request.params.outputs.every((output) => output.blinder === 'explicit')).toBe(true)
  })
})

describe('buildDemoIssueAssetRequest', () => {
  it('creates one issuance input and token plus asset outputs', () => {
    const { contractHash, request } = buildDemoIssueAssetRequest({
      network: 'testnet-liquid',
      feeRateSatKvb: FEE_RATE_SAT_KVB,
      destinationScriptPubkeyHex: '0014' + '33'.repeat(20),
      issueAmountSat: 1_000,
    })

    expect(contractHash).toMatch(/^[0-9a-f]{64}$/)
    expect(request.broadcast).toBe(true)
    expect(request.params.fee_rate_sat_kvb).toBe(FEE_RATE_SAT_KVB)
    expect(request.params.inputs).toHaveLength(1)
    expect(request.params.inputs[0]).toMatchObject({
      id: 'issue-input',
      issuance: {
        kind: 'new',
        asset_amount_sat: 1_000,
        token_amount_sat: 1,
      },
      utxo_source: {
        wallet: {
          filter: {
            asset: {
              exact: {
                asset_id: POLICY_ASSET_ID.testnet,
              },
            },
          },
        },
      },
    })
    expect(request.params.outputs).toEqual([
      expect.objectContaining({
        id: 'issue-token-output',
        amount_sat: 1,
        asset: {
          type: 'new_issuance_token',
          input_index: 0,
        },
        blinder: 'explicit',
      }),
      expect.objectContaining({
        id: 'issue-asset-output',
        amount_sat: 1_000,
        asset: {
          type: 'new_issuance_asset',
          input_index: 0,
        },
        blinder: 'explicit',
      }),
    ])
  })
})

describe('buildDemoReissueAssetRequest', () => {
  it('spends a reissuance token and creates the reissued asset output', () => {
    const request = buildDemoReissueAssetRequest({
      network: 'testnet-liquid',
      feeRateSatKvb: FEE_RATE_SAT_KVB,
      destinationScriptPubkeyHex: '0014' + '44'.repeat(20),
      reissuanceTokenId: 'cd'.repeat(32),
      assetEntropy: 'ef'.repeat(32),
      reissueAmountSat: 750,
    })

    expect(request.params.inputs).toHaveLength(1)
    expect(request.params.inputs[0]).toMatchObject({
      id: 'reissue-input',
      utxo_source: {
        wallet: {
          filter: {
            asset: {
              exact: {
                asset_id: 'cd'.repeat(32),
              },
            },
            amount: {
              min: {
                amount_sat: 1,
              },
            },
          },
        },
      },
      issuance: {
        kind: 'reissue',
        asset_amount_sat: 750,
        token_amount_sat: 0,
      },
    })
    expect(request.params.outputs).toEqual([
      expect.objectContaining({
        id: 'reissue-token-return',
        amount_sat: 1,
        asset: {
          type: 'asset_id',
          asset_id: 'cd'.repeat(32),
        },
        blinder: 'explicit',
      }),
      expect.objectContaining({
        id: 'reissue-asset-output',
        amount_sat: 750,
        asset: {
          type: 're_issuance_asset',
          input_index: 0,
        },
        blinder: 'explicit',
      }),
    ])
  })
})
