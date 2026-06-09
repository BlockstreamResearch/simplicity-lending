import type { Transaction } from 'lwk_web'
import { sources } from 'virtual:simplicity-sources'

import { extractOpReturnPayload } from '@/utils/opReturn'
import { sha256 } from '@/utils/sha256'
import {
  type Bytes32,
  toBytes32,
  toUint16,
  toUint32,
  toUint64,
  type Uint16,
  type Uint32,
  type Uint64,
} from '@/utils/uint'

const PROGRAM_ID_LENGTH = 4
const PRINCIPAL_ASSET_ID_OFFSET = PROGRAM_ID_LENGTH
const PRINCIPAL_AMOUNT_OFFSET = PRINCIPAL_ASSET_ID_OFFSET + 32
const LOAN_EXPIRATION_TIME_OFFSET = PRINCIPAL_AMOUNT_OFFSET + 8
const PRINCIPAL_INTEREST_RATE_OFFSET = LOAN_EXPIRATION_TIME_OFFSET + 4
const PENDING_OFFER_METADATA_LENGTH = PRINCIPAL_INTEREST_RATE_OFFSET + 2

export interface PendingOfferMetadata {
  principalAssetId: Bytes32
  principalAmount: Uint64
  loanExpirationTime: Uint32
  principalInterestRate: Uint16
}

export async function buildPendingOfferMetadata(params: PendingOfferMetadata): Promise<Uint8Array> {
  const data = new Uint8Array(PENDING_OFFER_METADATA_LENGTH)
  const view = new DataView(data.buffer)

  data.set(await getLendingProgramId(), 0)
  data.set(params.principalAssetId, PRINCIPAL_ASSET_ID_OFFSET)
  view.setBigUint64(PRINCIPAL_AMOUNT_OFFSET, params.principalAmount, true)
  view.setUint32(LOAN_EXPIRATION_TIME_OFFSET, params.loanExpirationTime, true)
  view.setUint16(PRINCIPAL_INTEREST_RATE_OFFSET, params.principalInterestRate, true)

  return data
}

// TODO: Indexer will handle `findPendingOfferMetadata` and `decodePendingOfferMetadata`
export async function findPendingOfferMetadata(
  transaction: Transaction,
): Promise<PendingOfferMetadata> {
  const expectedProgramId = await getLendingProgramId()

  for (const txOut of transaction.outputs) {
    const payload = extractOpReturnPayload(txOut.scriptPubkey())
    if (!payload || payload.length !== PENDING_OFFER_METADATA_LENGTH) continue
    if (!bytesEqual(payload.subarray(0, PROGRAM_ID_LENGTH), expectedProgramId)) continue

    return decodePendingOfferMetadata(payload)
  }

  throw new Error('Transaction does not contain Lending pending offer metadata')
}

function decodePendingOfferMetadata(payload: Uint8Array): PendingOfferMetadata {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)

  return {
    principalAssetId: toBytes32(
      payload.slice(PRINCIPAL_ASSET_ID_OFFSET, PRINCIPAL_AMOUNT_OFFSET),
      'principalAssetId',
    ),
    principalAmount: toUint64(view.getBigUint64(PRINCIPAL_AMOUNT_OFFSET, true), 'principalAmount'),
    loanExpirationTime: toUint32(
      view.getUint32(LOAN_EXPIRATION_TIME_OFFSET, true),
      'loanExpirationTime',
    ),
    principalInterestRate: toUint16(
      view.getUint16(PRINCIPAL_INTEREST_RATE_OFFSET, true),
      'principalInterestRate',
    ),
  }
}

async function getLendingProgramId(): Promise<Uint8Array> {
  const hash = await sha256(new TextEncoder().encode(sources.lending))
  return new Uint8Array(hash).slice(0, PROGRAM_ID_LENGTH)
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index])
}
