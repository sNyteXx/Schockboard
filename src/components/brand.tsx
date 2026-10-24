import { Text, View } from 'react-native'

import type { ThemeId } from '@/domain/types'
import { colors, radius, spacing } from '@/theme/tokens'

/**
 * A code-drawn BVB-inspired round emblem. No remotely loaded or bundled
 * third-party logo artwork is required to render it, including offline.
 */
export function BrandEmblem({ size = 72, themeId }: { size?: number; themeId: ThemeId }) {
  const isBvb = themeId === 'bvb09'

  return (
    <View
      accessible
      accessibilityLabel={isBvb ? 'BVB 09 Emblem' : 'Schockboard Emblem'}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: isBvb ? '#FDE100' : colors.accent,
        borderWidth: Math.max(2, size * 0.05),
        borderColor: '#050705',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOpacity: 0.4,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 5 },
        elevation: 4,
      }}
    >
      <View
        style={{
          width: size * 0.84,
          height: size * 0.84,
          borderRadius: size * 0.42,
          borderColor: '#111711',
          borderWidth: Math.max(1, size * 0.018),
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          allowFontScaling={false}
          style={{ color: '#090B09', fontWeight: '900', fontSize: size * (isBvb ? 0.25 : 0.34), letterSpacing: -size * 0.014, lineHeight: size * 0.28 }}
        >
          {isBvb ? 'BVB' : '⚄'}
        </Text>
        {isBvb ? (
          <Text allowFontScaling={false} style={{ color: '#090B09', fontWeight: '900', fontSize: size * 0.25, letterSpacing: -1, lineHeight: size * 0.25 }}>
            09
          </Text>
        ) : null}
      </View>
    </View>
  )
}

export function BrandHero({
  title,
  subtitle,
  themeId,
  aside,
}: {
  title: string
  subtitle: string
  themeId: ThemeId
  aside?: React.ReactNode
}) {
  const bvb = themeId === 'bvb09'

  return (
    <View
      style={{
        borderRadius: radius.lg,
        overflow: 'hidden',
        padding: spacing.lg,
        backgroundColor: bvb ? '#151C11' : colors.bgElevated,
        borderWidth: 1,
        borderColor: colors.border,
        gap: spacing.md,
      }}
    >
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 5, backgroundColor: colors.accent }} />
      <View pointerEvents="none" style={{ position: 'absolute', right: -52, top: -72, width: 250, height: 250, borderRadius: 125, borderWidth: 3, borderColor: colors.accent, opacity: 0.07 }} />
      <View pointerEvents="none" style={{ position: 'absolute', right: -20, top: -40, width: 184, height: 184, borderRadius: 92, borderWidth: 2, borderColor: colors.accent, opacity: 0.06 }} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, alignItems: 'center' }}>
        <BrandEmblem size={76} themeId={themeId} />
        <View style={{ flex: 1, minWidth: 185, gap: 4 }}>
          <Text style={{ color: colors.accentStrong, fontSize: 11, fontWeight: '900', letterSpacing: 2.4 }}>
            {bvb ? 'SCHWARZGELB · SCHOCKBOARD 2.0' : 'SCHOCKBOARD 2.0'}
          </Text>
          <Text style={{ color: colors.text, fontSize: 29, fontWeight: '900', letterSpacing: -1 }} numberOfLines={2}>
            {title}
          </Text>
          <Text style={{ color: colors.muted, lineHeight: 21 }}>{subtitle}</Text>
        </View>
        {aside}
      </View>
    </View>
  )
}
