import { env } from '@/constants/env'
import { NETWORK_CONFIG } from '@/constants/network-config'

import { requestJson, type RequestParams } from '../client'
import { type AssetPricesUsd, liquidPricesResponseSchema } from './schemas'

// Backend bug: the testnet prices endpoint returns mainnet LBTC/USDT asset IDs
// instead of testnet ones. Remap them to the testnet IDs from network-config
// until it's fixed — once fixed, delete this whole block to revert.
const MAINNET_LBTC_ID = '6f0279e9ed041c3d710a9f57d0c02928416460c4b722ae3457a11eec381c526d'
const MAINNET_USDT_ID = 'ce091c998b83c78bb71a632313ba3760f1763d9cfcffae02258ffa9865a37bd2'

function applyTestnetAssetIdMock(data: Record<string, string>): Record<string, string> {
  if (env.VITE_NETWORK !== 'liquidtestnet') return data
  return Object.fromEntries(
    Object.entries(data).map(([assetId, price]) => {
      if (assetId === MAINNET_LBTC_ID) return [NETWORK_CONFIG.collateralAsset.id, price]
      if (assetId === MAINNET_USDT_ID) return [NETWORK_CONFIG.principalAsset.id, price]
      return [assetId, price]
    }),
  )
}

export async function fetchLiquidPricesUsd(options: RequestParams = {}): Promise<AssetPricesUsd> {
  const response = await requestJson(
    `${env.VITE_API_URL}/prices/v1/liquid/USD`,
    liquidPricesResponseSchema,
    { signal: options.signal },
  )
  const data = applyTestnetAssetIdMock(response.data)
  return Object.fromEntries(
    Object.entries(data).map(([assetId, price]) => [assetId, Number(price)]),
  )
}
