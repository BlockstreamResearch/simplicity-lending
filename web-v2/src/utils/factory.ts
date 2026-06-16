import type { FactoryDetails } from '@/api/indexer/schemas'

export interface FactoryState {
  factoryAssetId: string
  factoryAuthOutpoint: string
  issuanceFactoryOutpoint: string
}

export function prepareFactory(factory: FactoryDetails): FactoryState | null {
  if (!factory.auth_utxo || !factory.program_utxo) return null
  return {
    factoryAssetId: factory.factory_asset_id,
    factoryAuthOutpoint: `${factory.auth_utxo.txid}:${factory.auth_utxo.vout}`,
    issuanceFactoryOutpoint: `${factory.program_utxo.txid}:${factory.program_utxo.vout}`,
  }
}
