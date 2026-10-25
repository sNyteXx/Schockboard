import Ionicons from '@expo/vector-icons/Ionicons'
import { Image, View } from 'react-native'

import type { ThemeId } from '@/domain/types'
import { colors } from '@/theme/tokens'

/**
 * Small brand mark for headers and the tablet rail (28–40 dp). BVB theme shows
 * the official crest (Wikimedia Commons copy of bvb.de's logo), the other
 * themes an accent disc with a die.
 */
export function BrandEmblem({ size = 32, themeId }: { size?: number; themeId: ThemeId }) {
  if (themeId === 'bvb09') {
    return (
      <Image
        source={require('../../assets/bvb09-official.png')}
        accessibilityLabel="Offizielles Borussia Dortmund BVB 09 Logo"
        resizeMode="contain"
        style={{ width: size, height: size }}
      />
    )
  }

  return (
    <View
      accessible
      accessibilityLabel="Schockboard Emblem"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.accent,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name="dice" size={Math.round(size * 0.56)} color={colors.buttonPrimaryText} />
    </View>
  )
}
