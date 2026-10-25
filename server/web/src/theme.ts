import { radius, spacing, THEMES, type ColorTheme } from '@/theme/tokens'

/**
 * CSS design tokens generated from the app's own palette (src/theme/tokens.ts,
 * 'bvb09' – "Gelbe Wand"), so the web and the app can never drift apart.
 * Applied to :root before the first render; styles.css only uses var(--…).
 */

export const WEB_THEME: ColorTheme = THEMES.bvb09

const kebab = (key: string) => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)

/** #RRGGBB → rgba() with the given alpha (soft fills of semantic colours). */
function soft(hex: string, alpha: number) {
  const value = Number.parseInt(hex.slice(1), 16)
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`
}

export function cssVariables(theme: ColorTheme = WEB_THEME): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const [key, value] of Object.entries(theme)) {
    if (key === 'id' || key === 'label') continue
    vars[`--${kebab(key)}`] = value
  }
  // Soft variants the app derives inline.
  vars['--info-soft'] = soft(theme.info, 0.13)
  vars['--accent-line'] = soft(theme.accent, 0.38)
  vars['--danger-line'] = soft(theme.danger, 0.38)
  // `subtle` (#6C7278) is below 4.5:1 on raised surfaces – decoration only.
  // Small text uses this AA-safe step between subtle and muted (≥ 4.6:1 on every surface).
  vars['--subtle-text'] = '#868C92'
  for (const [key, value] of Object.entries(radius)) vars[`--radius-${key}`] = `${value}px`
  for (const [key, value] of Object.entries(spacing)) vars[`--space-${key}`] = `${value}px`
  return vars
}

export function applyTheme(root: HTMLElement = document.documentElement) {
  for (const [name, value] of Object.entries(cssVariables())) root.style.setProperty(name, value)
  root.style.colorScheme = 'dark'
}
