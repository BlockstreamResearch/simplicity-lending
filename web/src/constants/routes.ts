export const RoutePath = {
  Dashboard: '/',
  Borrow: '/borrow',
  Supply: '/supply',
  DesignSystem: '/design-system',
  Demo: '/demo',
} as const

export type RoutePath = (typeof RoutePath)[keyof typeof RoutePath]
