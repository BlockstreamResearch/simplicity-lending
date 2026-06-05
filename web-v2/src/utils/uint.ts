const MAX_U8 = 0xff
const MAX_U32 = 0xffff_ffff
const MAX_U64 = (1n << 64n) - 1n

export function isUint8(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_U8
}

export function isUint32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_U32
}

export function isUint64(value: bigint): boolean {
  return value >= 0n && value <= MAX_U64
}
