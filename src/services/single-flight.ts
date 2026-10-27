/**
 * Lets one action through, then ignores repeats for `cooldownMs`. Booking
 * handlers are synchronous, so "busy while running" alone never blocks a
 * double tap – the lock has to outlive the handler until the form is reset.
 * Returns whether the action ran.
 */
export function createSingleFlight(cooldownMs = 800, now: () => number = Date.now) {
  let lockedUntil = 0
  return function once(action: () => void): boolean {
    if (now() < lockedUntil) return false
    lockedUntil = now() + cooldownMs
    try {
      action()
      return true
    } catch (error) {
      // A rejected booking (validation error) may be retried right away.
      lockedUntil = 0
      throw error
    }
  }
}
