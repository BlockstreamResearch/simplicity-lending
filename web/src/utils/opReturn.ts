import type { Script } from '@lilbonekit/lwk-web'

const OP_RETURN = 0x6a
const OP_PUSHDATA1 = 0x4c
const OP_PUSHDATA2 = 0x4d
const OP_PUSHDATA4 = 0x4e
const MAX_DIRECT_PUSH_LENGTH = 0x4b

export function extractOpReturnPayload(script: Script): Uint8Array | null {
  const bytes = script.bytes()
  if (bytes[0] !== OP_RETURN || bytes.length < 2) return null

  const pushOpcode = bytes[1]
  if (pushOpcode === undefined) return null

  const pushData = readPushData(bytes, pushOpcode)
  if (!pushData) return null

  const payloadEnd = pushData.offset + pushData.length
  if (payloadEnd !== bytes.length) return null

  return bytes.slice(pushData.offset, payloadEnd)
}

function readPushData(
  bytes: Uint8Array,
  pushOpcode: number,
): { length: number; offset: number } | null {
  if (pushOpcode <= MAX_DIRECT_PUSH_LENGTH) {
    return { length: pushOpcode, offset: 2 }
  }

  if (pushOpcode === OP_PUSHDATA1 && bytes.length >= 3) {
    return { length: bytes[2] ?? 0, offset: 3 }
  }

  if (pushOpcode === OP_PUSHDATA2 && bytes.length >= 4) {
    return {
      length: new DataView(bytes.buffer, bytes.byteOffset + 2, 2).getUint16(0, true),
      offset: 4,
    }
  }

  if (pushOpcode === OP_PUSHDATA4 && bytes.length >= 6) {
    return {
      length: new DataView(bytes.buffer, bytes.byteOffset + 2, 4).getUint32(0, true),
      offset: 6,
    }
  }

  return null
}
