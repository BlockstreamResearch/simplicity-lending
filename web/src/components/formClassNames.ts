/**
 * Shared form class names (inputs, labels, selects, tooltips).
 * Matches button style system: single radius (rounded-xl), brand focus ring.
 */

const inputRadius = 'rounded-xl'
const borderBase = 'border border-gray-300'
const focusRing =
  'focus:outline-none focus:ring-2 focus:ring-[#5F3DC4] focus:ring-offset-1 focus:border-[#5F3DC4]'

export const formClassNames = {
  /** Base input/select field: rounded-xl, white bg, focus ring. */
  input: `${inputRadius} ${borderBase} bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 ${focusRing} disabled:opacity-50 disabled:bg-gray-50`,

  /** Wrapper for input + right suffix (e.g. "LBTC", "USDT"): same border and radius. */
  inputWithSuffixWrapper: `${inputRadius} ${borderBase} bg-white flex items-center overflow-hidden focus-within:ring-2 focus-within:ring-[#5F3DC4] focus-within:ring-offset-1 focus-within:border-[#5F3DC4]`,

  /** The actual input inside inputWithSuffixWrapper (no border-radius on right if suffix present). */
  inputWithSuffixField:
    'flex-1 min-w-0 border-0 bg-transparent px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-0 focus:outline-none',

  /** Suffix text inside wrapper (e.g. "LBTC"). */
  inputSuffix: 'shrink-0 px-3 py-2 text-sm text-gray-500',

  /** Tighter vertical padding for inputs (use with compact prop). */
  inputCompactPadding: 'py-1.5',
  inputSuffixCompactPadding: 'py-1.5',

  /** Label above field. */
  label: 'block font-medium text-gray-900 text-sm mb-1',

  /** Helper text below field (e.g. range or description). */
  helper: 'text-xs text-gray-500 mt-1',

  /** Select trigger (visible part) — same as input. */
  select: `${inputRadius} ${borderBase} bg-white px-3 py-2 text-sm text-gray-900 ${focusRing} appearance-none bg-[length:1rem_1rem] bg-[right_0.5rem_center] bg-no-repeat disabled:opacity-50 disabled:bg-gray-50`,

  /** Custom dropdown list container. */
  dropdownList: `${inputRadius} border border-gray-200 bg-white shadow-lg py-1 mt-1 max-h-60 overflow-auto`,

  /** Dropdown option item. */
  dropdownItem: 'px-3 py-2 text-sm text-gray-900 hover:bg-gray-50 cursor-pointer',

  /** Tooltip/popover container (for ? icon). ~half form width for fewer lines. */
  tooltip: `${inputRadius} border border-gray-200 bg-white shadow-lg px-3 py-2 text-sm text-gray-700 max-w-[16rem]`,
} as const
