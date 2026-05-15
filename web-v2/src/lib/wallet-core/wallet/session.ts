import type { EsploraClient, Wollet, WolletDescriptor } from 'lwk_web'

import type { WalletConnector } from '../connector/types'

export type WalletSession = {
  connector: WalletConnector
  descriptor: WolletDescriptor
  wollet: Wollet
  esploraClient: EsploraClient
}
