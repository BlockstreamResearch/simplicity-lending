const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'

function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
  let chk = 1
  for (const v of values) {
    const b = chk >> 25
    chk = ((chk & 0x1ffffff) << 5) ^ v
    for (let i = 0; i < 5; i++) {
      if ((b >> i) & 1) chk ^= GEN[i]
    }
  }
  return chk
}

function bech32HrpExpand(hrp: string): number[] {
  const ret: number[] = []
  for (const c of hrp) ret.push(c.charCodeAt(0) >> 5)
  ret.push(0)
  for (const c of hrp) ret.push(c.charCodeAt(0) & 31)
  return ret
}

function bech32CreateChecksum(hrp: string, data: number[]): number[] {
  const values = [...bech32HrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0]
  const polymod = bech32Polymod(values) ^ 1
  const ret: number[] = []
  for (let i = 0; i < 6; i++) {
    ret.push((polymod >> (5 * (5 - i))) & 31)
  }
  return ret
}

function bech32Encode(hrp: string, data: number[]): string {
  const checksum = bech32CreateChecksum(hrp, data)
  const combined = [...data, ...checksum]
  return `${hrp}1${combined.map(d => BECH32_CHARSET[d]).join('')}`
}

function convertBits(data: number[], fromBits: number, toBits: number, pad: boolean): number[] {
  let acc = 0
  let bits = 0
  const ret: number[] = []
  const maxValue = (1 << toBits) - 1
  for (const value of data) {
    if (value < 0 || value >> fromBits !== 0) throw new Error('Invalid byte value')
    acc = (acc << fromBits) | value
    bits += fromBits
    while (bits >= toBits) {
      bits -= toBits
      ret.push((acc >> bits) & maxValue)
    }
  }
  if (pad) {
    if (bits > 0) ret.push((acc << (toBits - bits)) & maxValue)
  } else if (bits >= fromBits || (acc << (toBits - bits)) & maxValue) {
    throw new Error('Invalid padding in witness program')
  }
  return ret
}

/**
 * Encodes a segwit v0 scriptPubkey (`OP_0 <push> <program>`, i.e. P2WPKH or P2WSH) as its
 * bech32 address under the given HRP (e.g. "tex" for liquidtestnet, "ex" for liquid mainnet).
 */
export function segwitV0ScriptPubkeyToAddress(scriptPubkey: Uint8Array, hrp: string): string {
  if (scriptPubkey.length < 4 || scriptPubkey[0] !== 0x00) {
    throw new Error('Only segwit v0 (OP_0) scriptPubkeys are supported')
  }
  const programLength = scriptPubkey[1]
  if (scriptPubkey.length !== 2 + programLength) {
    throw new Error('scriptPubkey length does not match its push byte')
  }
  const program = scriptPubkey.slice(2)
  const data5Bit = convertBits(Array.from(program), 8, 5, true)
  return bech32Encode(hrp, [0, ...data5Bit])
}
