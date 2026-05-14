import { normalizeHex } from '@/utils/hex'

import type { OfferDetails, OfferParticipant, ParticipantType } from './schemas'

export function filterOfferDetailsByParticipantRole(
  offers: OfferDetails[],
  scriptPubkeyHex: string,
  role: ParticipantType,
): OfferDetails[] {
  const targetScript = normalizeHex(scriptPubkeyHex)
  return offers.filter(offer =>
    offer.participants.some(
      participant =>
        participant.participant_type === role &&
        normalizeHex(participant.script_pubkey) === targetScript,
    ),
  )
}

export function getCurrentParticipantByRole(
  history: OfferParticipant[],
  role: ParticipantType,
): OfferParticipant | null {
  const unspentEntries = history.filter(
    participant => participant.participant_type === role && participant.spent_txid === null,
  )
  if (unspentEntries.length === 0) return null
  const sortedByHeight = [...unspentEntries].sort(
    (left, right) => right.created_at_height - left.created_at_height,
  )
  return sortedByHeight[0] ?? null
}
