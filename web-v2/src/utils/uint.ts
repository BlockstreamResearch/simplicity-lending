const MAX_U8 = 0xff
const MAX_U16 = 0xffff
const MAX_U32 = 0xffff_ffff
const MAX_U64 = (1n << 64n) - 1n

declare const bytes32Brand: unique symbol
declare const uint8Brand: unique symbol
declare const uint16Brand: unique symbol
declare const uint32Brand: unique symbol
declare const uint64Brand: unique symbol

export type Bytes32 = Uint8Array & { readonly [bytes32Brand]: never }
export type Uint8 = number & { readonly [uint8Brand]: never }
export type Uint16 = number & { readonly [uint16Brand]: never }
export type Uint32 = number & { readonly [uint32Brand]: never }
export type Uint64 = bigint & { readonly [uint64Brand]: never }

export function toBytes32(value: Uint8Array, label = 'Value'): Bytes32 {
  if (value.length !== 32) {
    throw new Error(`${label} must be 32 bytes`)
  }

  return value as Bytes32
}

export function toUint8(value: number, label = 'Value'): Uint8 {
  if (!Number.isInteger(value) || value < 0 || value > MAX_U8) {
    throw new Error(`${label} must fit into u8`)
  }

  return value as Uint8
}

export function toUint16(value: number, label = 'Value'): Uint16 {
  if (!Number.isInteger(value) || value < 0 || value > MAX_U16) {
    throw new Error(`${label} must fit into u16`)
  }

  return value as Uint16
}

export function toUint32(value: number, label = 'Value'): Uint32 {
  if (!Number.isInteger(value) || value < 0 || value > MAX_U32) {
    throw new Error(`${label} must fit into u32`)
  }

  return value as Uint32
}

export function toUint64(value: bigint, label = 'Value'): Uint64 {
  if (value < 0n || value > MAX_U64) {
    throw new Error(`${label} must fit into u64`)
  }

  return value as Uint64
}
