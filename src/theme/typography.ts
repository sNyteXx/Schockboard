import type { TextStyle } from 'react-native'

/**
 * Type scale. Barlow Condensed = scoreboard (numbers, KPIs, screen titles),
 * Inter = everything else. Custom fonts carry their weight in the family
 * name, so styles never set fontWeight (Android would fake-bold them).
 */
export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  displaySemibold: 'BarlowCondensed_600SemiBold',
  display: 'BarlowCondensed_700Bold',
} as const

export type TypeVariant =
  | 'scoreboard'
  | 'display'
  | 'title'
  | 'heading'
  | 'subheading'
  | 'body'
  | 'bodyStrong'
  | 'label'
  | 'caption'
  | 'overline'
  | 'numeric'
  | 'numericLg'
  | 'numericSm'

type BaseStyle = { fontFamily: string; fontSize: number; lineHeight: number; letterSpacing?: number; textTransform?: TextStyle['textTransform'] }

/** Sizes for phones (compact); scaled up via typeScaleFor() on bigger windows. */
const BASE: Record<TypeVariant, BaseStyle> = {
  /** Live-board loss counter. */
  scoreboard: { fontFamily: fonts.display, fontSize: 64, lineHeight: 66 },
  /** Hero KPI value. */
  display: { fontFamily: fonts.display, fontSize: 42, lineHeight: 46, letterSpacing: 0.2 },
  /** Screen title. */
  title: { fontFamily: fonts.display, fontSize: 30, lineHeight: 34, letterSpacing: 0.3 },
  /** Section / card heading. */
  heading: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22, letterSpacing: -0.2 },
  subheading: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22 },
  /** Buttons, chips, tab labels. */
  label: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18 },
  caption: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
  /** Small uppercase eyebrow. */
  overline: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 14, letterSpacing: 1.1, textTransform: 'uppercase' },
  numeric: { fontFamily: fonts.display, fontSize: 24, lineHeight: 28, letterSpacing: 0.2 },
  numericLg: { fontFamily: fonts.display, fontSize: 32, lineHeight: 36, letterSpacing: 0.2 },
  numericSm: { fontFamily: fonts.displaySemibold, fontSize: 17, lineHeight: 20, letterSpacing: 0.2 },
}

/**
 * Global type multiplier by window width: phones 1.0, foldable inner /
 * portrait tablets 1.08, landscape tablets 1.15, 14" class (≥ 1400 dp) 1.25.
 */
export function typeScaleFor(width: number) {
  if (width >= 1400) return 1.25
  if (width >= 1000) return 1.15
  if (width >= 600) return 1.08
  return 1
}

export type TypeScale = Record<TypeVariant, TextStyle>

export function buildTypeScale(scale: number): TypeScale {
  const result = {} as TypeScale
  for (const key of Object.keys(BASE) as TypeVariant[]) {
    const base = BASE[key]
    const isNumeric = key === 'scoreboard' || key === 'display' || key.startsWith('numeric')
    result[key] = {
      ...base,
      fontSize: Math.round(base.fontSize * scale),
      lineHeight: Math.round(base.lineHeight * scale),
      ...(isNumeric ? { fontVariant: ['tabular-nums'] as TextStyle['fontVariant'] } : null),
    }
  }
  return result
}

const cache = new Map<number, TypeScale>()

/** Memoised scale – the same object for the same multiplier. */
export function getTypeScale(scale: number) {
  let value = cache.get(scale)
  if (!value) {
    value = buildTypeScale(scale)
    cache.set(scale, value)
  }
  return value
}
