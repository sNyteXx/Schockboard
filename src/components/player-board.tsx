import { Pressable, Text, View } from 'react-native'

import { formatCurrency } from '@/domain/format'
import { useDeviceLayout } from '@/hooks/use-device-layout'
import { colors, radius, spacing } from '@/theme/tokens'

export type BoardPlayer = {
  id: string
  name: string
  isCore: boolean
  lossCount: number
  todayCents: number
}

export function PlayerBoard({
  players,
  stakeCents,
  isClosed,
  onAdd,
  onRemove,
}: {
  players: BoardPlayer[]
  stakeCents: number
  isClosed: boolean
  onAdd: (id: string) => void
  onRemove: (id: string) => void
}) {
  const { width, isTablet, isWide } = useDeviceLayout()
  const columns = isWide || isTablet || width >= 400 ? 2 : 1

  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm }}>
        <View style={{ gap: 4, flex: 1 }}>
          <Text style={{ color: colors.accentStrong, fontSize: 11, letterSpacing: 1.8, fontWeight: '900' }}>LIVE AM TISCH</Text>
          <Text style={{ color: colors.text, fontWeight: '900', fontSize: 23, letterSpacing: -0.5 }}>Schnellbuchung</Text>
        </View>
        <View style={{ backgroundColor: colors.surfaceSoft, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 8 }}>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>+ {formatCurrency(stakeCents)} / Verlust</Text>
        </View>
      </View>

      {players.length === 0 ? (
        <Text style={{ color: colors.muted, lineHeight: 22 }}>Noch niemand anwesend. Aktiviere rechts beziehungsweise unterhalb des Bretts die gewünschten Spieler.</Text>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'stretch' }}>
          {players.map((player) => (
            <View
              key={player.id}
              style={{
                width: columns === 2 ? '48%' : '100%',
                flexGrow: 1,
                minWidth: 0,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radius.lg,
                padding: spacing.md,
                gap: spacing.sm,
              }}
            >
              <View style={{ minHeight: 44, gap: 4 }}>
                <Text style={{ fontSize: 17, color: colors.text, fontWeight: '900' }} numberOfLines={2}>{player.name}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{player.isCore ? 'STAMMRUNDE' : 'GAST'} · {formatCurrency(player.todayCents)}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Letzten Verlust von ${player.name} stornieren`}
                  disabled={isClosed || player.lossCount === 0}
                  onPress={() => onRemove(player.id)}
                  style={({ pressed }) => ({
                    minWidth: 50,
                    minHeight: 54,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: radius.sm,
                    borderWidth: 1,
                    borderColor: colors.border,
                    backgroundColor: colors.surfaceSoft,
                    opacity: isClosed || player.lossCount === 0 ? 0.3 : pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{ color: colors.text, fontSize: 26, fontWeight: '700' }}>−</Text>
                </Pressable>
                <View style={{ alignItems: 'center', minWidth: 34 }}>
                  <Text style={{ color: colors.text, fontSize: 29, fontWeight: '900', fontVariant: ['tabular-nums'] }}>{player.lossCount}</Text>
                  <Text style={{ color: colors.muted, fontSize: 10 }}>VERLUSTE</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Verlust für ${player.name} buchen`}
                  disabled={isClosed}
                  onPress={() => onAdd(player.id)}
                  style={({ pressed }) => ({
                    minWidth: 56,
                    minHeight: 56,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: radius.sm,
                    backgroundColor: colors.accent,
                    opacity: isClosed ? 0.4 : pressed ? 0.75 : 1,
                    transform: [{ scale: pressed ? 0.96 : 1 }],
                  })}
                >
                  <Text style={{ color: colors.buttonPrimaryText, fontSize: 30, fontWeight: '900' }}>＋</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}
