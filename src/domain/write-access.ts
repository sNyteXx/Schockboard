let handoff = false

export function setHandoffLocked(locked: boolean) { handoff = locked }
export function isHandoffLocked() { return handoff }
export function assertWritable() {
  if (handoff) throw new Error('Geräteumzug aktiv. Buchungen sind auf diesem Gerät gesperrt.')
}
