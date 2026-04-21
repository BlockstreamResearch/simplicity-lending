export function jsonReplacer(_key: string, value: unknown) {
  return typeof value === 'bigint' ? value.toString() : value
}

export function formatJson(value: unknown): string {
  return `${JSON.stringify(value, jsonReplacer, 2)}\n`
}

