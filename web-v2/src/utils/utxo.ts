export function selectByLargestFirst<T extends { value: bigint }>(
  items: T[],
  target: bigint,
): T[] | null {
  const sorted = [...items].sort((a, b) => (a.value > b.value ? -1 : a.value < b.value ? 1 : 0))
  const selected: T[] = []
  let sum = 0n
  for (const item of sorted) {
    if (sum >= target) break
    selected.push(item)
    sum += item.value
  }
  return sum >= target ? selected : null
}
