import * as Haptics from 'expo-haptics'

let enabled = true
export function setHapticsEnabled(value: boolean) { enabled = value }

// Haptics are a nice-to-have: never let a missing vibrator break a booking.
function fire(effect: () => Promise<void>) {
  if (!enabled) return
  effect().catch(() => undefined)
}

export const Feedback = {
  tap() {
    fire(() => Haptics.selectionAsync())
  },
  booked() {
    fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium))
  },
  reverted() {
    fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light))
  },
  success() {
    fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success))
  },
  error() {
    fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error))
  },
}
