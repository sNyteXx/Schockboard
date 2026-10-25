/**
 * Pure coach-mark tour logic (no React Native imports – unit-tested in
 * tests/tour-*.test.ts): step sequencing/skipping, tooltip placement,
 * spotlight geometry and the persisted progress format.
 */

/** Screens that announce themselves to the tour while focused. */
export type TourScreen = 'dashboard' | 'sessions' | 'evening' | 'cashbox'

export type TargetPress =
  /** Call the target's registered action, then (by default) advance. */
  | 'perform'
  /** Advance without touching the real control (never books anything). */
  | 'advance'
  /** The hole is interactive: the real control receives the touch. */
  | 'passthrough'
  /** Taps on the hole do nothing. */
  | 'block'

export type TourStep = {
  id: string
  title: string
  body: string
  /** Screens on which this step may show; undefined = any screen. */
  screens?: TourScreen[]
  /** Candidate target ids in priority order (first mounted one wins). */
  targets: string[]
  targetPress: TargetPress
  /** With targetPress 'perform': advance after the action (default true). */
  advanceAfterPerform?: boolean
  /** Hide "Weiter" – the user moves on by tapping the highlighted control. */
  requiresTargetTap?: boolean
  /** "Weiter" also runs the target's action (pure navigation only). */
  nextPerformsAction?: boolean
  /** Without a mounted target the step shows as a centred text-only card. */
  textOnlyFallback?: boolean
  /** The step is done as soon as one of these screens is focused. */
  completeOnScreens?: TourScreen[]
}

export type StepContext = {
  /** Focused tour screen, null when an unregistered screen is shown. */
  screen: TourScreen | null
  /** Currently mounted target ids. */
  targets: ReadonlySet<string>
  /** How long the step's screen has been shown without any of its targets. */
  waitedMs: number
  /** Grace period before a step with a missing target is skipped. */
  graceMs?: number
}

export type StepDecision =
  | { kind: 'show'; targetId: string | null }
  /** missingTarget: the right screen is shown but the target is not (yet) mounted. */
  | { kind: 'wait'; missingTarget: boolean }
  | { kind: 'skip' }
  | { kind: 'complete' }

export const TARGET_GRACE_MS = 700

export function evaluateStep(step: TourStep, ctx: StepContext): StepDecision {
  if (ctx.screen && step.completeOnScreens?.includes(ctx.screen)) return { kind: 'complete' }
  if (step.screens && (!ctx.screen || !step.screens.includes(ctx.screen))) return { kind: 'wait', missingTarget: false }
  const targetId = step.targets.find((id) => ctx.targets.has(id))
  if (targetId) return { kind: 'show', targetId }
  if (step.textOnlyFallback) return { kind: 'show', targetId: null }
  if (ctx.waitedMs >= (ctx.graceMs ?? TARGET_GRACE_MS)) return { kind: 'skip' }
  return { kind: 'wait', missingTarget: true }
}

/** Index after `index`, or null when the tour is finished. */
export function nextIndex(steps: readonly TourStep[], index: number): number | null {
  return index + 1 < steps.length ? index + 1 : null
}

/**
 * Nearest earlier step that can be shown right now (same screen, target
 * mounted). Steps of other screens are never jumped back to.
 */
export function previousShowableIndex(steps: readonly TourStep[], index: number, ctx: Omit<StepContext, 'waitedMs'>): number | null {
  for (let candidate = index - 1; candidate >= 0; candidate--) {
    const decision = evaluateStep(steps[candidate], { ...ctx, waitedMs: 0 })
    if (decision.kind === 'show') return candidate
  }
  return null
}

/** Human step counter, e.g. "2/9". */
export function stepCounter(index: number, total: number) {
  return `${index + 1}/${total}`
}

// ---------------------------------------------------------------------------
// Geometry

export type Rect = { x: number; y: number; width: number; height: number }
export type Size = { width: number; height: number }
export type Insets = { top: number; bottom: number; left: number; right: number }

export type TooltipPlacement = { left: number; top: number; width: number; placement: 'above' | 'below' | 'center' }

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max))

/** Card width: full width minus margins on phones, at most `maxWidth` dp. */
export function tooltipWidth(viewportWidth: number, insets: Insets, margin = 16, maxWidth = 400) {
  return Math.max(200, Math.min(maxWidth, viewportWidth - insets.left - insets.right - margin * 2))
}

/** Spotlight hole: target plus padding, kept inside the viewport. */
export function spotlightRect(target: Rect, viewport: Size, padding = 6): Rect {
  const x = clamp(target.x - padding, 0, viewport.width)
  const y = clamp(target.y - padding, 0, viewport.height)
  const right = clamp(target.x + target.width + padding, x, viewport.width)
  const bottom = clamp(target.y + target.height + padding, y, viewport.height)
  return { x, y, width: right - x, height: bottom - y }
}

/**
 * Places the tooltip below the spotlight when it fits, else above, else on
 * the side with more room (overlapping, clamped to the safe area). Without a
 * target the card is centred.
 */
export function placeTooltip(input: {
  target: Rect | null
  viewport: Size
  insets: Insets
  size: Size
  gap?: number
  margin?: number
}): TooltipPlacement {
  const { target, viewport, insets, size } = input
  const gap = input.gap ?? 12
  const margin = input.margin ?? 16
  const minTop = insets.top + margin
  const maxBottom = viewport.height - insets.bottom - margin
  const minLeft = insets.left + margin
  const maxLeft = viewport.width - insets.right - margin - size.width
  const clampTop = (top: number) => clamp(top, minTop, maxBottom - size.height)

  if (!target) {
    return { left: clamp((viewport.width - size.width) / 2, minLeft, maxLeft), top: clampTop((viewport.height - size.height) / 2), width: size.width, placement: 'center' }
  }

  const left = clamp(target.x + target.width / 2 - size.width / 2, minLeft, maxLeft)
  const belowTop = target.y + target.height + gap
  const aboveTop = target.y - gap - size.height
  const spaceBelow = maxBottom - belowTop
  const spaceAbove = target.y - gap - minTop

  if (spaceBelow >= size.height) return { left, top: belowTop, width: size.width, placement: 'below' }
  if (spaceAbove >= size.height) return { left, top: aboveTop, width: size.width, placement: 'above' }
  return spaceBelow >= spaceAbove
    ? { left, top: clampTop(belowTop), width: size.width, placement: 'below' }
    : { left, top: clampTop(aboveTop), width: size.width, placement: 'above' }
}

/** True when the target is fully inside the visible band (not under bars). */
export function isRectVisible(rect: Rect, viewport: Size, insets: Insets, bottomReserve = 0) {
  return rect.y >= insets.top && rect.y + rect.height <= viewport.height - insets.bottom - bottomReserve
}

/**
 * SVG path for the dim layer: full-screen rectangle plus a rounded-rect hole
 * (use with fillRule="evenodd"). Worklet so it can drive animated props.
 */
export function spotlightPath(viewportWidth: number, viewportHeight: number, x: number, y: number, width: number, height: number, cornerRadius: number) {
  'worklet'
  const r = Math.max(0, Math.min(cornerRadius, width / 2, height / 2))
  const outer = `M0 0H${viewportWidth}V${viewportHeight}H0Z`
  if (width <= 0 || height <= 0) return outer
  const hole =
    `M${x + r} ${y}H${x + width - r}` +
    `A${r} ${r} 0 0 1 ${x + width} ${y + r}V${y + height - r}` +
    `A${r} ${r} 0 0 1 ${x + width - r} ${y + height}H${x + r}` +
    `A${r} ${r} 0 0 1 ${x} ${y + height - r}V${y + r}` +
    `A${r} ${r} 0 0 1 ${x + r} ${y}Z`
  return outer + hole
}

/** Touch-blocking rectangles around the hole (top, bottom, left, right). */
export function blockerRects(hole: Rect | null, viewport: Size): Rect[] {
  if (!hole) return [{ x: 0, y: 0, width: viewport.width, height: viewport.height }]
  return [
    { x: 0, y: 0, width: viewport.width, height: hole.y },
    { x: 0, y: hole.y + hole.height, width: viewport.width, height: Math.max(0, viewport.height - hole.y - hole.height) },
    { x: 0, y: hole.y, width: hole.x, height: hole.height },
    { x: hole.x + hole.width, y: hole.y, width: Math.max(0, viewport.width - hole.x - hole.width), height: hole.height },
  ].filter((rect) => rect.width > 0 && rect.height > 0)
}

export function sameRect(a: Rect | null, b: Rect | null, tolerance = 0.5) {
  if (!a || !b) return a === b
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance && Math.abs(a.width - b.width) <= tolerance && Math.abs(a.height - b.height) <= tolerance
}

// ---------------------------------------------------------------------------
// Persistence (expo-secure-store key schockboard.tour.v1)

export const TOUR_STORAGE_KEY = 'schockboard.tour.v1'

export type PersistedTour =
  | { status: 'new' }
  | { status: 'running'; stepId: string }
  | { status: 'done' }
  | { status: 'skipped' }

export function parseTourState(raw: string | null | undefined): PersistedTour {
  if (!raw) return { status: 'new' }
  try {
    const value = JSON.parse(raw) as { status?: unknown; stepId?: unknown }
    if (value.status === 'done' || value.status === 'skipped') return { status: value.status }
    if (value.status === 'running' && typeof value.stepId === 'string') return { status: 'running', stepId: value.stepId }
  } catch {
    // corrupt value: treat as never shown
  }
  return { status: 'new' }
}

export function serializeTourState(state: PersistedTour) {
  return JSON.stringify(state)
}

/** Index to resume a running tour at (0 for unknown step ids). */
export function resumeIndex(steps: readonly TourStep[], state: PersistedTour) {
  if (state.status !== 'running') return 0
  return Math.max(0, steps.findIndex((step) => step.id === state.stepId))
}

/** Auto-start once: never shown before, on the dashboard, with players. */
export function shouldAutoStart(state: PersistedTour, screen: TourScreen | null, hasPlayers: boolean) {
  return state.status === 'new' && screen === 'dashboard' && hasPlayers
}
