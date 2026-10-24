import { randomUUID as nodeRandomUUID } from 'node:crypto'

/** Server stand-in for the subset of expo-crypto used by src/services/id.ts. */
export function randomUUID() {
  return nodeRandomUUID()
}
