export const RoutePath = {
  Landing: '/',
  Dashboard: '/app',
  Borrow: '/app/borrow',
  Supply: '/app/supply',
  Offer: '/app/offers/:offerId',
  DesignSystem: '/app/design-system',
  Demo: '/app/demo',
} as const

export type RoutePath = (typeof RoutePath)[keyof typeof RoutePath]
