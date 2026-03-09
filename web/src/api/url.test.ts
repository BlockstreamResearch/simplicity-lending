import { describe, expect, it } from 'vitest'

import { buildConfiguredUrl } from './url'

describe('buildConfiguredUrl', () => {
  it('keeps absolute API bases absolute', () => {
    expect(buildConfiguredUrl('https://api.example.com', '/offers')).toBe(
      'https://api.example.com/offers'
    )
  })

  it('resolves root-relative API bases against the browser origin', () => {
    expect(buildConfiguredUrl('/api', '/offers', 'https://app.example.com')).toBe(
      'https://app.example.com/api/offers'
    )
  })

  it('resolves plain relative API bases against the browser origin', () => {
    expect(buildConfiguredUrl('api', 'offers/by-borrower-pubkey', 'https://app.example.com')).toBe(
      'https://app.example.com/api/offers/by-borrower-pubkey'
    )
  })
})
