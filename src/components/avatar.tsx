import { memo } from 'react'
import { Text, View } from 'react-native'

import { colors, playerColor, playerInitials, withAlpha } from '@/theme/tokens'
import { fonts } from '@/theme/typography'

/**
 * Player identity: initials on a tinted circle in the player's stable colour.
 * `ring` adds an accent ring (e.g. Pechvogel / selected), `muted` greys it out
 * (absent players).
 */
export const PlayerAvatar = memo(function PlayerAvatar({
  id,
  name,
  size = 36,
  ring = false,
  muted = false,
  solid = false,
}: {
  id: string
  name: string
  size?: number
  ring?: boolean
  muted?: boolean
  /** Filled circle with dark initials (high-contrast board tiles). */
  solid?: boolean
}) {
  const tint = muted ? colors.subtle : playerColor(id)
  return (
    <View
      accessible={false}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: solid ? tint : withAlpha(tint, muted ? 0.12 : 0.18),
        borderWidth: ring ? 2 : 1,
        borderColor: ring ? colors.accent : withAlpha(tint, solid ? 0 : 0.35),
      }}
    >
      <Text
        allowFontScaling={false}
        style={{
          color: solid ? '#0B0C0E' : tint,
          fontFamily: fonts.bold,
          fontSize: Math.round(size * 0.38),
          lineHeight: Math.round(size * 0.46),
          letterSpacing: 0.2,
        }}
      >
        {playerInitials(name)}
      </Text>
    </View>
  )
})
