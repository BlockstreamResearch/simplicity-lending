const HEX_PATTERN = /^[0-9a-f]+$/

export function normalizeHex(hexInput: string): string {
  return hexInput.trim().toLowerCase().replace(/^0x/, '').replace(/\s/g, '')
}

export function isHexString(input: string): boolean {
  const normalized = normalizeHex(input)
  return normalized.length > 0 && normalized.length % 2 === 0 && HEX_PATTERN.test(normalized)
}

export function isHexStringOfByteLength(input: string, byteLength: number): boolean {
  const normalized = normalizeHex(input)
  return normalized.length === byteLength * 2 && isHexString(normalized)
}

export function hexToBytes(hexString: string): Uint8Array<ArrayBuffer> {
  const normalized = normalizeHex(hexString)
  if (normalized.length % 2 !== 0) {
    throw new Error('hex string must have even length')
  }
  const byteLength = normalized.length / 2
  const bytes = new Uint8Array(new ArrayBuffer(byteLength))
  for (let index = 0; index < byteLength; index++) {
    bytes[index] = parseInt(normalized.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function bytes32ToHex(b: Uint8Array): string {
  if (b.length !== 32) throw new Error('Expected 32 bytes')
  return bytesToHex(b)
}

export function hexToBytes32(hex: string): Uint8Array {
  const s = normalizeHex(hex)
  if (s.length !== 64) throw new Error('Expected 64 hex chars for 32-byte value')
  return hexToBytes(s)
}
