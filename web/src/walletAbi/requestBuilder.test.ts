import { beforeAll, describe, expect, it } from 'vitest'
import { loadLwkWalletAbiWeb, scriptFromHex } from 'lwk_wallet_abi_sdk'
import { P2PK_NETWORK, POLICY_ASSET_ID } from '../utility/addressP2pk'
import { WalletAbiRequestBuilder, walletAbiWalletFilter } from './requestBuilder'

describe('WalletAbiRequestBuilder', () => {
  beforeAll(async () => {
    await loadLwkWalletAbiWeb()
  })

  it('builds a broadcast create request with stable runtime ordering', () => {
    const request = new WalletAbiRequestBuilder()
      .walletInputByFilter('fee-input', walletAbiWalletFilter())
      .explicitOutput(
        'borrower-output',
        scriptFromHex('00140000000000000000000000000000000000000000'),
        POLICY_ASSET_ID[P2PK_NETWORK],
        1_234n
      )
      .lockTimeHeight(144)
      .buildCreate()

    expect(request.broadcast()).toBe(true)
    expect(request.params().feeRateSatKvb()).toBe(100)
    expect(request.params().lockTime()).toBeDefined()
    expect(request.params().inputs().map((input) => input.id())).toEqual(['fee-input'])
    expect(request.params().outputs().map((output) => output.id())).toEqual(['borrower-output'])
    expect(request.params().outputs()[0]?.amountSat()).toBe(1_234n)
  })
})
