import { useEffect, useRef, useState } from 'react'
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native'

import { UndoService } from '@/services/undo-service'
import { colors, radius, spacing } from '@/theme/tokens'

export function UndoToast({
  actor,
  onUndo,
}: {
  actor: { id: string; username: string } | null
  onUndo: () => void
}) {
  const [label, setLabel] = useState<string | null>(null)
  const fadeAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const interval = setInterval(() => {
      const pending = UndoService.getPendingUndo()
      if (pending && pending.label !== label) {
        setLabel(pending.label)
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }).start()
      } else if (!pending && label) {
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start(() => setLabel(null))
      }
    }, 200)

    return () => clearInterval(interval)
  }, [label, fadeAnim])

  async function handleUndo() {
    if (!actor) return
    try {
      await UndoService.executeUndo({ accountId: actor.id, username: actor.username })
      onUndo()
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(() => setLabel(null))
    } catch {
      // Undo failed, just hide
    }
  }

  if (!label) return null

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      <Text style={styles.text}>{label}</Text>
      <Pressable onPress={handleUndo} style={styles.button}>
        <Text style={styles.buttonText}>Undo</Text>
      </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bgElevated,
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  text: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  button: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  buttonText: {
    color: colors.buttonPrimaryText,
    fontWeight: '700',
    fontSize: 14,
  },
})
