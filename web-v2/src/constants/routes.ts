export const RoutePath = {
  Dashboard: '/',
  Borrow: '/borrow',
  Supply: '/supply',
  DesignSystem: '/design-system',
} as const

export type RoutePath = (typeof RoutePath)[keyof typeof RoutePath]
