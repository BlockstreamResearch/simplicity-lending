const MAX_U8 = 0xff
const MAX_U16 = 0xffff
const MAX_U32 = 0xffff_ffff
const MAX_U64 = (1n << 64n) - 1n

export function isUint8(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_U8
}

export function isUint16(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_U16
}

export function isUint32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_U32
}

export function isUint64(value: bigint): boolean {
  return value >= 0n && value <= MAX_U64
}

export function assertBytes32(value: Uint8Array, label: string): void {
  if (value.length !== 32) {
    throw new Error(`${label} must be 32 bytes`)
  }
}

export function assertUint32(value: number, label: string): void {
  if (!isUint32(value)) {
    throw new Error(`${label} must fit into u32`)
  }
}

export function assertUint64(value: bigint, label: string): void {
  if (!isUint64(value)) {
    throw new Error(`${label} must fit into u64`)
  }
}
