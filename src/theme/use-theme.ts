import { useMemo } from 'react'
import { StyleSheet } from 'react-native'

import { useDeviceLayout } from '@/hooks/use-device-layout'
import { colors, type ColorTheme } from '@/theme/tokens'
import { getTypeScale, type TypeScale } from '@/theme/typography'

export type ThemeContext = {
  c: ColorTheme
  t: TypeScale
  scale: number
  sizeClass: 'compact' | 'medium' | 'expanded'
}

/** Current palette + scaled type ramp. Re-renders follow the runtime theme switch. */
export function useTheme() {
  const layout = useDeviceLayout()
  const t = getTypeScale(layout.typeScale)
  return { c: colors, t, layout }
}

/**
 * Builds a StyleSheet hook cached per theme id + type scale + size class:
 *   const useStyles = themedStyles(({ c, t }) => ({ title: { ...t.title, color: c.text } }))
 */
export function themedStyles<T extends StyleSheet.NamedStyles<T>>(factory: (context: ThemeContext) => T) {
  const cache = new Map<string, T>()
  return function useThemedStyles(): T {
    const { typeScale, sizeClass } = useDeviceLayout()
    const key = `${colors.id}|${typeScale}|${sizeClass}`
    return useMemo(() => {
      let styles = cache.get(key)
      if (!styles) {
        styles = StyleSheet.create(
          factory({ c: { ...colors }, t: getTypeScale(typeScale), scale: typeScale, sizeClass: sizeClass as ThemeContext['sizeClass'] })
        )
        cache.set(key, styles)
      }
      return styles
    }, [key])
  }
}
