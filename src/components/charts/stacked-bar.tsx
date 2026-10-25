import { memo } from 'react'
import { View } from 'react-native'

import { colors, radius } from '@/theme/tokens'

export type StackedSegment = { key: string; value: number; color: string }

/** Thin horizontal stacked bar; `total` defaults to the sum of segments. */
export const StackedBar = memo(function StackedBar({
  segments,
  total,
  height = 8,
  gap = 2,
}: {
  segments: StackedSegment[]
  total?: number
  height?: number
  gap?: number
}) {
  const sum = segments.reduce((value, segment) => value + Math.max(0, segment.value), 0)
  const base = Math.max(1, total ?? sum)
  const visible = segments.filter((segment) => segment.value > 0)
  return (
    <View style={{ height, borderRadius: radius.pill, backgroundColor: colors.surfaceSoft, overflow: 'hidden', flexDirection: 'row', gap }} accessible={false}>
      {visible.map((segment) => (
        <View key={segment.key} style={{ width: `${(segment.value / base) * 100}%`, backgroundColor: segment.color, borderRadius: radius.pill }} />
      ))}
    </View>
  )
})
