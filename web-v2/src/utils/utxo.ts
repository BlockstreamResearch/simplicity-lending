interface SelectUtxosOptions {
  perItemReserve?: bigint
}

function selectBySorted<T extends { value: bigint }>(
  items: T[],
  target: bigint,
  compare: (a: T, b: T) => number,
  options: SelectUtxosOptions = {},
): T[] | null {
  const sorted = [...items].sort(compare)
  const selected: T[] = []
  let sum = 0n
  const perItemReserve = options.perItemReserve ?? 0n
  for (const item of sorted) {
    selected.push(item)
    sum += item.value
    const targetWithReserve = target + BigInt(selected.length) * perItemReserve
    if (sum >= targetWithReserve) return selected
  }
  return null
}

export function selectByLargestFirst<T extends { value: bigint }>(
  items: T[],
  target: bigint,
  options?: SelectUtxosOptions,
): T[] | null {
  return selectBySorted(
    items,
    target,
    (a, b) => (a.value > b.value ? -1 : a.value < b.value ? 1 : 0),
    options,
  )
}

export function selectBySmallestFirst<T extends { value: bigint }>(
  items: T[],
  target: bigint,
  options?: SelectUtxosOptions,
): T[] | null {
  return selectBySorted(
    items,
    target,
    (a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0),
    options,
  )
}
