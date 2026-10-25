import { describe, expect, it } from 'vitest'

import {
  blockerRects,
  evaluateStep,
  isRectVisible,
  nextIndex,
  parseTourState,
  placeTooltip,
  previousShowableIndex,
  resumeIndex,
  serializeTourState,
  shouldAutoStart,
  spotlightPath,
  spotlightRect,
  stepCounter,
  tooltipWidth,
  type TourStep,
} from '@/components/tour/tour-logic'
import { FIRST_EVENING_TOUR, TOUR_TARGETS } from '@/components/tour/tour-steps'

const noInsets = { top: 0, bottom: 0, left: 0, right: 0 }
const phoneInsets = { top: 32, bottom: 24, left: 0, right: 0 }
const phone = { width: 412, height: 915 }
const foldable = { width: 810, height: 900 }
const tablet = { width: 1690, height: 1056 }

describe('tour tooltip placement', () => {
  const size = { width: 380, height: 180 }

  it('places below a target near the top', () => {
    const target = { x: 16, y: 120, width: 380, height: 48 }
    const result = placeTooltip({ target, viewport: phone, insets: phoneInsets, size })
    expect(result.placement).toBe('below')
    expect(result.top).toBe(120 + 48 + 12)
    expect(result.left).toBe(16)
  })

  it('places above a target near the bottom (tab bar)', () => {
    const target = { x: 280, y: 850, width: 68, height: 56 }
    const result = placeTooltip({ target, viewport: phone, insets: phoneInsets, size })
    expect(result.placement).toBe('above')
    expect(result.top).toBe(850 - 12 - 180)
    // Clamped to the right margin.
    expect(result.left + size.width).toBeLessThanOrEqual(phone.width - 16)
  })

  it('overlaps but stays on screen for huge targets', () => {
    const target = { x: 0, y: 40, width: 412, height: 860 }
    const result = placeTooltip({ target, viewport: phone, insets: phoneInsets, size })
    expect(result.top).toBeGreaterThanOrEqual(phoneInsets.top + 16)
    expect(result.top + size.height).toBeLessThanOrEqual(phone.height - phoneInsets.bottom - 16)
  })

  it('centres text-only cards', () => {
    const result = placeTooltip({ target: null, viewport: tablet, insets: noInsets, size: { width: 400, height: 200 } })
    expect(result.placement).toBe('center')
    expect(result.left).toBe((1690 - 400) / 2)
    expect(result.top).toBe((1056 - 200) / 2)
  })

  it('centres horizontally on the target on wide screens', () => {
    const target = { x: 1500, y: 400, width: 100, height: 60 }
    const result = placeTooltip({ target, viewport: tablet, insets: noInsets, size: { width: 400, height: 200 } })
    expect(result.left).toBe(1690 - 16 - 400)
    const left = placeTooltip({ target: { x: 700, y: 400, width: 100, height: 60 }, viewport: tablet, insets: noInsets, size: { width: 400, height: 200 } })
    expect(left.left).toBe(750 - 200)
  })

  it('sizes the card for phone, foldable and tablet', () => {
    expect(tooltipWidth(phone.width, noInsets)).toBe(380)
    expect(tooltipWidth(foldable.width, noInsets)).toBe(400)
    expect(tooltipWidth(tablet.width, { top: 0, bottom: 0, left: 48, right: 48 })).toBe(400)
    expect(tooltipWidth(320, noInsets)).toBe(288)
  })
})

describe('tour spotlight geometry', () => {
  it('pads and clamps the hole to the viewport', () => {
    expect(spotlightRect({ x: 10, y: 10, width: 100, height: 40 }, phone, 6)).toEqual({ x: 4, y: 4, width: 112, height: 52 })
    expect(spotlightRect({ x: 0, y: 900, width: 412, height: 40 }, phone, 6)).toEqual({ x: 0, y: 894, width: 412, height: 21 })
  })

  it('builds an even-odd path with a rounded hole', () => {
    const d = spotlightPath(400, 800, 10, 20, 100, 50, 14)
    expect(d.startsWith('M0 0H400V800H0Z')).toBe(true)
    expect(d).toContain('M24 20H96A14 14 0 0 1 110 34')
    expect(spotlightPath(400, 800, 10, 20, 0, 0, 14)).toBe('M0 0H400V800H0Z')
    // Radius never exceeds half the hole height.
    expect(spotlightPath(400, 800, 0, 0, 100, 10, 14)).toContain('A5 5')
  })

  it('blocks everything except the hole', () => {
    const blocks = blockerRects({ x: 10, y: 100, width: 50, height: 40 }, { width: 200, height: 400 })
    expect(blocks).toHaveLength(4)
    const area = blocks.reduce((sum, rect) => sum + rect.width * rect.height, 0)
    expect(area).toBe(200 * 400 - 50 * 40)
    expect(blockerRects(null, { width: 200, height: 400 })).toEqual([{ x: 0, y: 0, width: 200, height: 400 }])
  })

  it('detects targets hidden under bars', () => {
    expect(isRectVisible({ x: 0, y: 100, width: 10, height: 10 }, phone, phoneInsets, 140)).toBe(true)
    expect(isRectVisible({ x: 0, y: 800, width: 10, height: 40 }, phone, phoneInsets, 140)).toBe(false)
    expect(isRectVisible({ x: 0, y: 10, width: 10, height: 40 }, phone, phoneInsets)).toBe(false)
  })
})

describe('tour step sequencing', () => {
  const steps = FIRST_EVENING_TOUR
  const byId = (id: string) => steps.find((step) => step.id === id)!

  it('has the nine first-evening steps in order', () => {
    expect(steps.map((step) => step.id)).toEqual(['start', 'attendance', 'stake', 'go', 'tile', 'beer', 'undo', 'finish', 'cashbox'])
    expect(stepCounter(1, steps.length)).toBe('2/9')
  })

  it('waits for the right screen', () => {
    const decision = evaluateStep(byId('attendance'), { screen: 'dashboard', targets: new Set([TOUR_TARGETS.attendance]), waitedMs: 5000 })
    expect(decision).toEqual({ kind: 'wait', missingTarget: false })
  })

  it('shows the first mounted candidate target', () => {
    const start = byId('start')
    expect(evaluateStep(start, { screen: 'dashboard', targets: new Set([TOUR_TARGETS.dashboardStart]), waitedMs: 0 })).toEqual({ kind: 'show', targetId: TOUR_TARGETS.dashboardStart })
    expect(evaluateStep(start, { screen: 'sessions', targets: new Set([TOUR_TARGETS.sessionsCreate]), waitedMs: 0 })).toEqual({ kind: 'show', targetId: TOUR_TARGETS.sessionsCreate })
  })

  it('completes the start step once the evening screen is shown', () => {
    expect(evaluateStep(byId('start'), { screen: 'evening', targets: new Set(), waitedMs: 0 })).toEqual({ kind: 'complete' })
  })

  it('skips a step whose target stays missing on its screen', () => {
    const stake = byId('stake')
    expect(evaluateStep(stake, { screen: 'evening', targets: new Set(), waitedMs: 100 })).toEqual({ kind: 'wait', missingTarget: true })
    expect(evaluateStep(stake, { screen: 'evening', targets: new Set(), waitedMs: 800 })).toEqual({ kind: 'skip' })
  })

  it('falls back to a text-only card for the undo hint', () => {
    expect(evaluateStep(byId('undo'), { screen: 'evening', targets: new Set(), waitedMs: 0 })).toEqual({ kind: 'show', targetId: null })
    expect(evaluateStep(byId('undo'), { screen: 'evening', targets: new Set([TOUR_TARGETS.undoToast]), waitedMs: 0 })).toEqual({ kind: 'show', targetId: TOUR_TARGETS.undoToast })
  })

  it('shows the cashbox tab step on any screen', () => {
    expect(evaluateStep(byId('cashbox'), { screen: null, targets: new Set([TOUR_TARGETS.cashboxTab]), waitedMs: 0 }).kind).toBe('show')
  })

  it('advances and finishes', () => {
    expect(nextIndex(steps, 0)).toBe(1)
    expect(nextIndex(steps, steps.length - 1)).toBeNull()
  })

  it('goes back only to showable steps on the same screen', () => {
    const evening = { screen: 'evening' as const, targets: new Set([TOUR_TARGETS.attendance, TOUR_TARGETS.stake, TOUR_TARGETS.go]) }
    expect(previousShowableIndex(steps, 3, evening)).toBe(2)
    // Live board: attendance/stake/go are gone, the dashboard step is another screen.
    expect(previousShowableIndex(steps, 4, { screen: 'evening', targets: new Set([TOUR_TARGETS.tile]) })).toBeNull()
    expect(previousShowableIndex(steps, 1, evening)).toBeNull()
  })

  it('never auto-performs a booking control', () => {
    const tile = byId('tile')
    const beer = byId('beer')
    expect(tile.targetPress).toBe('advance')
    expect(tile.nextPerformsAction).toBeFalsy()
    expect(beer.targetPress).toBe('advance')
    expect(beer.nextPerformsAction).toBeFalsy()
  })

  it('evaluates custom steps generically', () => {
    const step: TourStep = { id: 'x', title: 'X', body: '', targets: ['a', 'b'], targetPress: 'advance' }
    expect(evaluateStep(step, { screen: null, targets: new Set(['b']), waitedMs: 0 })).toEqual({ kind: 'show', targetId: 'b' })
    expect(evaluateStep(step, { screen: null, targets: new Set(), waitedMs: 50, graceMs: 10 })).toEqual({ kind: 'skip' })
  })
})

describe('tour persistence', () => {
  it('round-trips states and tolerates garbage', () => {
    expect(parseTourState(null)).toEqual({ status: 'new' })
    expect(parseTourState('nope{')).toEqual({ status: 'new' })
    expect(parseTourState('{"status":"running"}')).toEqual({ status: 'new' })
    for (const state of [{ status: 'done' }, { status: 'skipped' }, { status: 'running', stepId: 'beer' }] as const) {
      expect(parseTourState(serializeTourState(state))).toEqual(state)
    }
  })

  it('resumes at the saved step', () => {
    expect(resumeIndex(FIRST_EVENING_TOUR, { status: 'running', stepId: 'beer' })).toBe(5)
    expect(resumeIndex(FIRST_EVENING_TOUR, { status: 'running', stepId: 'gone' })).toBe(0)
    expect(resumeIndex(FIRST_EVENING_TOUR, { status: 'done' })).toBe(0)
  })

  it('auto-starts once on the dashboard with players', () => {
    expect(shouldAutoStart({ status: 'new' }, 'dashboard', true)).toBe(true)
    expect(shouldAutoStart({ status: 'new' }, 'dashboard', false)).toBe(false)
    expect(shouldAutoStart({ status: 'new' }, 'evening', true)).toBe(false)
    expect(shouldAutoStart({ status: 'done' }, 'dashboard', true)).toBe(false)
    expect(shouldAutoStart({ status: 'skipped' }, 'dashboard', true)).toBe(false)
  })
})
