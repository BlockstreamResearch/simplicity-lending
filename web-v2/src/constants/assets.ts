import type { NetworkName } from '@/constants/env'

// Asset IDs per network — Liquid mainnet / testnet / regtest.
export const NETWORK_ASSETS_CONFIG: Record<NetworkName, { LBTC: string; USDT: string }> = {
  liquid: {
    LBTC: '6f0279e9ed041c3d710a9f57d0c02928416460c4b722ae3457a11eec381c526d',
    USDT: 'ce091c998b83c78bb71a632313ba3760f1763d9cfcffae02258ffa9865a37bd2',
  },
  liquidtestnet: {
    LBTC: '144c654344aa716d6f3abcc1ca90e5641e4e2a7f633bc09fe3baf64585819a49',
    USDT: 'f3d1ec678811398cd2ae277cbe3849c6f6dbd72c74bc542f7c4b11ff0e820958',
  },
  regtest: {
    LBTC: '5ac9f65c0efcc4775e0baec4ec03abdde22473cd3cf33c0419ca290e0751b225',
    USDT: '25b17682b0e4f7b0711de7e8ee2e33cd01d65680eed82cce1af84cfbdde30064',
  },
}

// TEST asset used as the principal on testnet (in place of USDT) — see the offer demos.
export const TESTNET_PRINCIPAL_ASSET_ID =
  '38fca2d939696061a8f76d4e6b5eecd54e3b4221c846f24a6b279e79952850a5'
