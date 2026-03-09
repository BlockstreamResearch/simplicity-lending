function hasUrlScheme(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(value)
}

function joinUrlParts(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, '')
  const normalizedPath = path.replace(/^\/+/, '')
  return `${normalizedBase}/${normalizedPath}`
}

export function buildConfiguredUrl(
  baseUrl: string,
  path: string,
  origin?: string
): string {
  const joined = joinUrlParts(baseUrl, path)
  if (hasUrlScheme(joined)) {
    return joined
  }

  const fallbackOrigin =
    origin ??
    (typeof window !== 'undefined' ? window.location.origin : 'http://localhost')

  return new URL(joined, fallbackOrigin).toString()
}
