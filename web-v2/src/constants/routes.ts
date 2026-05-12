export const RoutePath = {
  Dashboard: '/',
  Borrow: '/borrow',
  Supply: '/supply',
} as const

export type RoutePath = (typeof RoutePath)[keyof typeof RoutePath]
