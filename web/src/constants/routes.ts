export const RoutePath = {
  Dashboard: '/',
  Borrow: '/borrow',
  Supply: '/supply',
  DesignSystem: '/design-system',
  Demo: '/demo',
  Landing: '/landing',
} as const

export type RoutePath = (typeof RoutePath)[keyof typeof RoutePath]
