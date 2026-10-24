/** Ease-out cubic, 0..1 → 0..1 (pure, used by the KPI count-up). */
export function easeOutCubic(progress: number) {
  const clamped = Math.min(1, Math.max(0, progress))
  return 1 - (1 - clamped) ** 3
}
