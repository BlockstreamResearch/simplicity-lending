/** Shared button class names for use outside Button components. */
export const buttonClassNames = {
  primary:
    'rounded-lg bg-[#5F3DC4] text-sm font-medium text-white hover:bg-[#4f36a8] focus:ring-2 focus:ring-[#5F3DC4] focus:ring-offset-1 disabled:opacity-50 disabled:pointer-events-none',
  secondary:
    'rounded-lg border-2 border-[#5F3DC4] bg-transparent text-sm font-medium text-[#5F3DC4] hover:bg-[#5F3DC4]/10 disabled:opacity-50 disabled:pointer-events-none',
  neutral:
    'rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400 disabled:opacity-50 disabled:pointer-events-none',
  neutralIcon: 'rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700',
  size: {
    sm: 'px-3 py-1.5',
    md: 'px-4 py-2',
    lg: 'px-4 py-2.5',
    icon: 'p-1.5',
    iconSm: 'p-1',
  },
} as const
