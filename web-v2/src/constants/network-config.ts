import type { ComponentType, SVGProps } from 'react'

import CoinsIcon from '@/components/icons/CoinsIcon'
import LbtcIcon from '@/components/icons/LbtcIcon'
import UsdtIcon from '@/components/icons/UsdtIcon'
import { env, type NetworkName } from '@/constants/env'

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

export interface ConfigAsset {
  id: string
  decimals: number
  symbol: string
  icon: IconComponent
}

export interface NetworkConfig {
  collateralAsset: ConfigAsset
  principalAsset: ConfigAsset
  protocolFeeAsset: ConfigAsset
}

// Which asset plays the collateral vs principal role, per network. Covenants
// themselves are asset-agnostic — this is the single place that pins them.
const NETWORK_CONFIG_BY_NETWORK: Record<NetworkName, NetworkConfig> = {
  liquid: {
    collateralAsset: {
      id: '6f0279e9ed041c3d710a9f57d0c02928416460c4b722ae3457a11eec381c526d',
      decimals: 8,
      symbol: 'LBTC',
      icon: LbtcIcon,
    },
    // USDT on liquid mainnet has 8 decimals.
    principalAsset: {
      id: 'ce091c998b83c78bb71a632313ba3760f1763d9cfcffae02258ffa9865a37bd2',
      decimals: 8,
      symbol: 'USDT',
      icon: UsdtIcon,
    },
    protocolFeeAsset: {
      id: 'ce091c998b83c78bb71a632313ba3760f1763d9cfcffae02258ffa9865a37bd2',
      decimals: 8,
      symbol: 'USDT',
      icon: UsdtIcon,
    },
  },
  liquidtestnet: {
    collateralAsset: {
      id: '144c654344aa716d6f3abcc1ca90e5641e4e2a7f633bc09fe3baf64585819a49',
      decimals: 8,
      symbol: 'LBTC',
      icon: LbtcIcon,
    },
    // TEST asset used as the principal on testnet (in place of USDT) — see the offer demos.
    principalAsset: {
      id: '38fca2d939696061a8f76d4e6b5eecd54e3b4221c846f24a6b279e79952850a5',
      decimals: 3,
      symbol: 'TEST',
      icon: CoinsIcon,
    },
    protocolFeeAsset: {
      id: '38fca2d939696061a8f76d4e6b5eecd54e3b4221c846f24a6b279e79952850a5',
      decimals: 3,
      symbol: 'TEST',
      icon: CoinsIcon,
    },
  },
  regtest: {
    collateralAsset: {
      id: '5ac9f65c0efcc4775e0baec4ec03abdde22473cd3cf33c0419ca290e0751b225',
      decimals: 8,
      symbol: 'LBTC',
      icon: LbtcIcon,
    },
    principalAsset: {
      id: '25b17682b0e4f7b0711de7e8ee2e33cd01d65680eed82cce1af84cfbdde30064',
      decimals: 2,
      symbol: 'USDT',
      icon: UsdtIcon,
    },
    protocolFeeAsset: {
      id: '25b17682b0e4f7b0711de7e8ee2e33cd01d65680eed82cce1af84cfbdde30064',
      decimals: 2,
      symbol: 'USDT',
      icon: UsdtIcon,
    },
  },
}

export const NETWORK_CONFIG = NETWORK_CONFIG_BY_NETWORK[env.VITE_NETWORK]
