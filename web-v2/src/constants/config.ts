import { NETWORK_ASSETS_CONFIG, TESTNET_PRINCIPAL_ASSET_ID } from '@/constants/assets'
import { env, type NetworkName } from '@/constants/env'

// Which asset plays the collateral vs principal role, per network. Covenants
// themselves are asset-agnostic — this is the single place that pins them.
interface LendingAssets {
  collateralAssetId: string
  principalAssetId: string
  collateralDecimals: number
  principalDecimals: number
  collateralSymbol: string
  principalSymbol: string
}

export const LENDING_CONFIG: Record<NetworkName, LendingAssets> = {
  liquid: {
    collateralAssetId: NETWORK_ASSETS_CONFIG.liquid.LBTC,
    principalAssetId: NETWORK_ASSETS_CONFIG.liquid.USDT,
    collateralDecimals: 8,
    principalDecimals: 8,
    collateralSymbol: 'LBTC',
    principalSymbol: 'USDT',
  },
  liquidtestnet: {
    collateralAssetId: NETWORK_ASSETS_CONFIG.liquidtestnet.LBTC,
    principalAssetId: TESTNET_PRINCIPAL_ASSET_ID,
    collateralDecimals: 8,
    principalDecimals: 3,
    collateralSymbol: 'LBTC',
    principalSymbol: 'TEST',
  },
  regtest: {
    collateralAssetId: NETWORK_ASSETS_CONFIG.regtest.LBTC,
    principalAssetId: NETWORK_ASSETS_CONFIG.regtest.USDT,
    collateralDecimals: 8,
    principalDecimals: 2,
    collateralSymbol: 'LBTC',
    principalSymbol: 'USDT',
  },
}

export const LENDING = LENDING_CONFIG[env.VITE_NETWORK]
