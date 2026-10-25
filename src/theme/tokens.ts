/**
 * Design tokens – "Stadion-Nacht".
 *
 * Layered dark surfaces (bg → bgElevated → surface → surfaceSoft), 1 px
 * hairlines, one precise accent colour and semantic colours. `colors` is a
 * mutable bag that setActiveTheme() overwrites in place so StyleSheets built
 * after a theme switch pick up the new palette.
 */
export type ColorTheme = {
  id: string
  label: string
  /** Base canvas behind everything. */
  bg: string
  /** Raised layer: cards, tab bar, sheets. */
  bgElevated: string
  /** Overlay layer: tiles inside cards, list rows. */
  surface: string
  /** Controls: inputs, secondary buttons, chart tracks. */
  surfaceSoft: string
  /** Pressed / hover state of surfaces. */
  surfaceHover: string
  accent: string
  accentStrong: string
  /** Accent at low alpha – active pills, highlighted rows. */
  accentSoft: string
  text: string
  /** Secondary text. */
  muted: string
  /** Tertiary text: axis labels, hints. */
  subtle: string
  /** 1 px hairline. */
  border: string
  borderStrong: string
  success: string
  successSoft: string
  warning: string
  warningSoft: string
  danger: string
  dangerSoft: string
  info: string
  tabBar: string
  /** Text/icon colour on accent fills. */
  buttonPrimaryText: string
  /** Hero KPI tile gradient (top-left → bottom-right). */
  heroFrom: string
  heroTo: string
}

export const THEMES: Record<string, ColorTheme> = {
  original: {
    id: 'original',
    label: 'Original – Warm & Gold',
    bg: '#0F0C09',
    bgElevated: '#17120E',
    surface: '#1F1914',
    surfaceSoft: '#29211A',
    surfaceHover: '#332920',
    accent: '#E3AB57',
    accentStrong: '#F4C67F',
    accentSoft: 'rgba(227, 171, 87, 0.14)',
    text: '#F7EFE4',
    muted: '#BBAC99',
    subtle: '#7F7262',
    border: 'rgba(255, 236, 210, 0.08)',
    borderStrong: 'rgba(255, 236, 210, 0.16)',
    success: '#4CC38A',
    successSoft: 'rgba(76, 195, 138, 0.14)',
    warning: '#EDB54E',
    warningSoft: 'rgba(237, 181, 78, 0.14)',
    danger: '#EC6E62',
    dangerSoft: 'rgba(236, 110, 98, 0.14)',
    info: '#8FB0FF',
    tabBar: '#130F0B',
    buttonPrimaryText: '#1A1108',
    heroFrom: '#2A1F12',
    heroTo: '#17120E',
  },
  bvb09: {
    id: 'bvb09',
    label: 'BVB 09 – Gelbe Wand',
    bg: '#08090A',
    bgElevated: '#101214',
    surface: '#171A1D',
    surfaceSoft: '#1F2327',
    surfaceHover: '#282D32',
    accent: '#FDE100',
    accentStrong: '#FFE94D',
    accentSoft: 'rgba(253, 225, 0, 0.12)',
    text: '#F5F6F3',
    muted: '#A4A9AF',
    subtle: '#6C7278',
    border: 'rgba(255, 255, 255, 0.07)',
    borderStrong: 'rgba(255, 255, 255, 0.14)',
    success: '#3DD68C',
    successSoft: 'rgba(61, 214, 140, 0.13)',
    warning: '#FFB547',
    warningSoft: 'rgba(255, 181, 71, 0.13)',
    danger: '#FF6B6B',
    dangerSoft: 'rgba(255, 107, 107, 0.13)',
    info: '#6CB6FF',
    tabBar: '#0B0C0E',
    buttonPrimaryText: '#08090A',
    heroFrom: '#24210A',
    heroTo: '#101214',
  },
  midnight: {
    id: 'midnight',
    label: 'Midnight – Dunkel & Blau',
    bg: '#0A0D13',
    bgElevated: '#10141C',
    surface: '#161B25',
    surfaceSoft: '#1E2430',
    surfaceHover: '#272E3C',
    accent: '#5B9DFF',
    accentStrong: '#8DBBFF',
    accentSoft: 'rgba(91, 157, 255, 0.14)',
    text: '#E9EEF6',
    muted: '#97A1B3',
    subtle: '#606A7C',
    border: 'rgba(170, 190, 230, 0.08)',
    borderStrong: 'rgba(170, 190, 230, 0.16)',
    success: '#3FCF8E',
    successSoft: 'rgba(63, 207, 142, 0.13)',
    warning: '#F0B44C',
    warningSoft: 'rgba(240, 180, 76, 0.13)',
    danger: '#F7676A',
    dangerSoft: 'rgba(247, 103, 106, 0.13)',
    info: '#A5D6FF',
    tabBar: '#0C1017',
    buttonPrimaryText: '#06101F',
    heroFrom: '#132238',
    heroTo: '#10141C',
  },
}

let activeTheme: ColorTheme = THEMES.bvb09

export function setActiveTheme(themeId: string) {
  activeTheme = THEMES[themeId] ?? THEMES.bvb09
  // Overwrite every key on the exported `colors` object so that
  // StyleSheet.create and inline styles both pick up the change
  // after a re-render.
  for (const key of Object.keys(activeTheme) as Array<keyof ColorTheme>) {
    ;(colors as Record<string, string>)[key] = activeTheme[key]
  }
}

export function getActiveTheme() {
  return activeTheme
}

// Mutable color bag – keys are overwritten by setActiveTheme()
export const colors: ColorTheme = { ...THEMES.bvb09 }

/** 4/8 dp grid. */
export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 40,
}

export const radius = {
  xs: 6,
  sm: 10,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
}

/**
 * Player identity colours – tuned for dark backgrounds, distinguishable in
 * charts. Picked by a stable hash of the player id (see playerColor()).
 */
export const PLAYER_PALETTE = [
  '#5AA9FF', // blau
  '#FF7A59', // koralle
  '#3DD6A0', // mint
  '#C08BFF', // lila
  '#FFC24B', // bernstein
  '#FF6FB1', // pink
  '#4FD3E8', // cyan
  '#A8D85A', // limette
  '#FF9F43', // orange
  '#8C9EFF', // indigo
]

/** FNV-1a – stable across sessions and platforms. */
export function hashString(value: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function playerColor(playerId: string) {
  return PLAYER_PALETTE[hashString(playerId) % PLAYER_PALETTE.length]
}

/** "Anna Lena" → "AL", "ben" → "BE", "" → "?". */
export function playerInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toLocaleUpperCase('de')
  return (parts[0][0] + parts[parts.length - 1][0]).toLocaleUpperCase('de')
}

/** Adds alpha to a #RRGGBB colour. */
export function withAlpha(hex: string, alpha: number) {
  if (!hex.startsWith('#') || hex.length !== 7) return hex
  const value = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
  return `${hex}${value.toString(16).padStart(2, '0')}`
}
