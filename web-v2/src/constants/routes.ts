export const RoutePath = {
  Dashboard: '/',
  Borrow: '/borrow',
  Supply: '/supply',
  DesignSystem: '/design-system',
  WalletDemo: '/wallet-demo',
  Demo: '/demo',
} as const

export type RoutePath = (typeof RoutePath)[keyof typeof RoutePath]
