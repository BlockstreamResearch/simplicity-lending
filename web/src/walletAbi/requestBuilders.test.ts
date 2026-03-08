import { describe, expect, it } from 'vitest'
import { POLICY_ASSET_ID } from '../utility/addressP2pk'
import {
  buildLendingParamsFromParameterNFTs,
  encodeFirstNFTParameters,
  encodeSecondNFTParameters,
} from '../utility/parametersEncoding'
import {
  buildIssueUtilityNftsRequest,
  buildPrepareUtilityNftsRequest,
  decodeIssuedUtilityNfts,
  resolvePrepareUtilityNftsInputUnblindings,
  type ProtocolTerms,
} from './requestBuilders'

describe('buildPrepareUtilityNftsRequest', () => {
  it('creates four explicit LBTC preparation outputs with no declared inputs', () => {
    const request = buildPrepareUtilityNftsRequest({
      network: 'localtest-liquid',
      destinationScriptPubkeyHex: '5120' + '11'.repeat(32),
    })

    expect(request.params.inputs).toEqual([])
    expect('fee_rate_sat_kvb' in request.params).toBe(false)
    expect(request.params.outputs).toHaveLength(4)
    expect(request.params.outputs.map((output) => output.id)).toEqual([
      'issuance-utxo-0',
      'issuance-utxo-1',
      'issuance-utxo-2',
      'issuance-utxo-3',
    ])
    expect(request.params.outputs.every((output) => output.amount_sat === 100)).toBe(true)
    expect(
      request.params.outputs.every(
        (output) =>
          output.asset.type === 'asset_id' &&
          output.asset.asset_id === POLICY_ASSET_ID.localtest
      )
    ).toBe(true)
  })
})

describe('buildIssueUtilityNftsRequest', () => {
  it('matches the Wallet ABI issuance shape from the Rust support flow', () => {
    const terms: ProtocolTerms = {
      collateralAmount: 25_000n,
      principalAmount: 10_000n,
      loanExpirationTime: 144,
      principalInterestRate: 500,
    }

    const request = buildIssueUtilityNftsRequest({
      network: 'localtest-liquid',
      destinationScriptPubkeyHex: '5120' + '22'.repeat(32),
      prepareTxid: 'ab'.repeat(32),
      terms,
    })

    const encodedFirst = encodeFirstNFTParameters(500, 144, 0, 0)
    const encodedSecond = encodeSecondNFTParameters(25_000, 10_000)

    expect(request.params.inputs.map((input) => input.id)).toEqual([
      'borrower-issuance',
      'lender-issuance',
      'first-parameters-issuance',
      'second-parameters-issuance',
      'issue-fee',
    ])
    expect(request.params.inputs.slice(0, 4).map((input) => input.utxo_source)).toEqual([
      { provided: { outpoint: `${'ab'.repeat(32)}:0` } },
      { provided: { outpoint: `${'ab'.repeat(32)}:1` } },
      { provided: { outpoint: `${'ab'.repeat(32)}:2` } },
      { provided: { outpoint: `${'ab'.repeat(32)}:3` } },
    ])
    expect(request.params.inputs.slice(0, 4).map((input) => input.unblinding)).toEqual([
      'explicit',
      'explicit',
      'explicit',
      'explicit',
    ])
    expect('fee_rate_sat_kvb' in request.params).toBe(false)
    expect(request.params.outputs).toHaveLength(8)
    expect(request.params.outputs[0]).toMatchObject({
      id: 'borrower-nft',
      amount_sat: 1,
      asset: { type: 'new_issuance_asset', input_index: 0 },
    })
    expect(request.params.outputs[1]).toMatchObject({
      id: 'lender-nft',
      amount_sat: 1,
      asset: { type: 'new_issuance_asset', input_index: 1 },
    })
    expect(request.params.outputs[2]).toMatchObject({
      id: 'first-parameters-nft',
      amount_sat: Number(encodedFirst),
      asset: { type: 'new_issuance_asset', input_index: 2 },
    })
    expect(request.params.outputs[3]).toMatchObject({
      id: 'second-parameters-nft',
      amount_sat: Number(encodedSecond),
      asset: { type: 'new_issuance_asset', input_index: 3 },
    })
  })

  it('accepts wallet-managed unblinding for confidential prepare outputs', () => {
    const request = buildIssueUtilityNftsRequest({
      network: 'testnet-liquid',
      destinationScriptPubkeyHex: '0014' + '22'.repeat(20),
      prepareTxid: 'cd'.repeat(32),
      prepareInputUnblindings: ['wallet', 'wallet', 'wallet', 'wallet'],
      terms: {
        collateralAmount: 25_000n,
        principalAmount: 10_000n,
        loanExpirationTime: 144,
        principalInterestRate: 500,
      },
    })

    expect(request.params.inputs.slice(0, 4).map((input) => input.unblinding)).toEqual([
      'wallet',
      'wallet',
      'wallet',
      'wallet',
    ])
  })
})

describe('resolvePrepareUtilityNftsInputUnblindings', () => {
  it('uses explicit unblinding for explicit prepare outputs', () => {
    expect(
      resolvePrepareUtilityNftsInputUnblindings({
        network: 'testnet-liquid',
        prepareTx: {
          txid: 'ef'.repeat(32),
          vout: Array.from({ length: 4 }, () => ({
            asset: POLICY_ASSET_ID.testnet,
            value: 100,
            scriptpubkey_hex: '0014' + '11'.repeat(20),
          })),
        },
      })
    ).toEqual(['explicit', 'explicit', 'explicit', 'explicit'])
  })

  it('uses wallet unblinding for confidential prepare outputs', () => {
    expect(
      resolvePrepareUtilityNftsInputUnblindings({
        network: 'testnet-liquid',
        prepareTx: {
          txid: 'ff'.repeat(32),
          vout: Array.from({ length: 4 }, () => ({
            scriptpubkey_hex: '0014' + '11'.repeat(20),
            valuecommitment: '09' + '00'.repeat(32),
            assetcommitment: '0a' + '11'.repeat(32),
            noncecommitment: '02' + '22'.repeat(32),
          })),
        },
      })
    ).toEqual(['wallet', 'wallet', 'wallet', 'wallet'])
  })

  it('rejects stale prepare transactions that do not contain four issuance outputs', () => {
    expect(() =>
      resolvePrepareUtilityNftsInputUnblindings({
        network: 'testnet-liquid',
        prepareTx: {
          txid: 'ab'.repeat(32),
          vout: [
            {
              asset: POLICY_ASSET_ID.testnet,
              value: 100,
              scriptpubkey_hex: '0014' + '11'.repeat(20),
            },
            {
              asset: POLICY_ASSET_ID.testnet,
              value: 61,
              scriptpubkey_hex: '',
            },
            {
              scriptpubkey_hex: '0014' + '11'.repeat(20),
              valuecommitment: '09' + '00'.repeat(32),
              assetcommitment: '0a' + '11'.repeat(32),
            },
          ],
        },
      })
    ).toThrow('Prepare tx output 1 must be 100 sats, got 61')
  })
})

describe('decodeIssuedUtilityNfts', () => {
  it('derives protocol terms from issuance outputs 0..3', () => {
    const firstParametersAmount = encodeFirstNFTParameters(250, 128, 0, 0)
    const secondParametersAmount = encodeSecondNFTParameters(5_000, 2_000)
    const decodedTerms = buildLendingParamsFromParameterNFTs(
      firstParametersAmount,
      secondParametersAmount
    )

    const issuance = decodeIssuedUtilityNfts({
      txid: 'cd'.repeat(32),
      vout: [
        { asset: '11'.repeat(32), value: 1, scriptpubkey_hex: '5120' + '11'.repeat(32) },
        { asset: '22'.repeat(32), value: 1, scriptpubkey_hex: '5120' + '11'.repeat(32) },
        {
          asset: '33'.repeat(32),
          value: Number(firstParametersAmount),
          scriptpubkey_hex: '5120' + '11'.repeat(32),
        },
        {
          asset: '44'.repeat(32),
          value: Number(secondParametersAmount),
          scriptpubkey_hex: '5120' + '11'.repeat(32),
        },
      ],
    })

    expect(issuance.terms).toEqual({
      collateralAmount: decodedTerms.collateralAmount,
      principalAmount: decodedTerms.principalAmount,
      loanExpirationTime: 128,
      principalInterestRate: 250,
    })
  })
})
