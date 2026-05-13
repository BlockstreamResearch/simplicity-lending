const HEX_PATTERN = /^[0-9a-f]+$/

export function normalizeHex(hexInput: string): string {
  return hexInput.trim().toLowerCase().replace(/^0x/, '')
}

export function isHexString(input: string): boolean {
  const normalized = normalizeHex(input).replace(/\s/g, '')
  return normalized.length > 0 && normalized.length % 2 === 0 && HEX_PATTERN.test(normalized)
}

export function hexToBytes(hexString: string): Uint8Array<ArrayBuffer> {
  const normalized = normalizeHex(hexString).replace(/\s/g, '')
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
