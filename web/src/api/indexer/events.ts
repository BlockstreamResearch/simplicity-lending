import { z as zod } from 'zod'

import { blockHeightSchema } from '@/utils/zod'

import { offerStatusSchema } from './schemas'

export const INDEXER_EVENT_NAMES = [
  'block_indexed',
  'factory_created',
  'offer_created',
  'offer_status_updated',
] as const
export type IndexerEventName = (typeof INDEXER_EVENT_NAMES)[number]

const indexerEventSchema = zod.discriminatedUnion('type', [
  zod.object({ type: zod.literal('block_indexed'), height: blockHeightSchema }),
  zod.object({
    type: zod.literal('factory_created'),
    id: zod.string(),
    height: blockHeightSchema,
    factory_auth_script_pubkey: zod.string(),
  }),
  zod.object({
    type: zod.literal('offer_created'),
    id: zod.string(),
    issuance_factory_id: zod.string(),
    height: blockHeightSchema,
    created_at_txid: zod.string(),
    borrower_script_pubkey: zod.string(),
  }),
  zod.object({
    type: zod.literal('offer_status_updated'),
    id: zod.string(),
    status: offerStatusSchema,
    height: blockHeightSchema,
  }),
])
export type IndexerEvent = zod.infer<typeof indexerEventSchema>

export function parseIndexerEvent(raw: string): IndexerEvent | null {
  try {
    return indexerEventSchema.safeParse(JSON.parse(raw)).data ?? null
  } catch {
    return null
  }
}
