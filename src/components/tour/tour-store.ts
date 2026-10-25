import type { RefObject } from 'react'
import type { View } from 'react-native'

import { resumeIndex, type PersistedTour, type TourScreen, type TourStep } from '@/components/tour/tour-logic'
import { FIRST_EVENING_TOUR } from '@/components/tour/tour-steps'

/** Scrolls the nearest <Screen> so a target becomes visible. */
export type TourScroller = { reveal: (target: View) => void }

export type TourTargetEntry = {
  ref: RefObject<View | null>
  action: RefObject<(() => void) | undefined>
  scroller: TourScroller | null
}

type Listener = () => void

/**
 * Module-level tour state. Targets register without subscribing, so screens
 * (and board taps) never re-render because of the tour; only the overlay
 * listens. While the tour is idle, target (un)registration emits nothing.
 */
let steps: readonly TourStep[] = FIRST_EVENING_TOUR
let persisted: PersistedTour | null = null
let running = false
let index = 0
let screen: TourScreen | null = null
let version = 0
const targets = new Map<string, TourTargetEntry>()
const listeners = new Set<Listener>()
const layoutListeners = new Set<(id: string) => void>()
let persist: ((state: PersistedTour) => void) | null = null

function emit() {
  version++
  listeners.forEach((listener) => listener())
}

function save(state: PersistedTour) {
  persisted = state
  persist?.(state)
}

export const tourStore = {
  subscribe(listener: Listener) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  getVersion: () => version,
  getSteps: () => steps,
  isRunning: () => running,
  getIndex: () => index,
  getScreen: () => screen,
  getPersisted: () => persisted,
  getTarget: (id: string) => targets.get(id),
  getTargetIds: () => new Set(targets.keys()),

  setPersistor(fn: ((state: PersistedTour) => void) | null) {
    persist = fn
  },

  /** Loaded state from secure store; resumes a tour that was interrupted. */
  hydrate(state: PersistedTour) {
    persisted = state
    if (state.status === 'running') {
      running = true
      index = resumeIndex(steps, state)
    }
    emit()
  },

  registerTarget(id: string, entry: TourTargetEntry) {
    targets.set(id, entry)
    if (running) emit()
    return () => {
      if (targets.get(id) !== entry) return
      targets.delete(id)
      if (running) emit()
    }
  },

  /** Called from target onLayout; cheap no-op while idle. */
  targetLayoutChanged(id: string) {
    if (!running) return
    layoutListeners.forEach((listener) => listener(id))
  },

  onTargetLayout(listener: (id: string) => void) {
    layoutListeners.add(listener)
    return () => {
      layoutListeners.delete(listener)
    }
  },

  setScreen(name: TourScreen, active: boolean) {
    if (active) {
      if (screen === name) return
      screen = name
    } else {
      if (screen !== name) return
      screen = null
    }
    emit()
  },

  start(at = 0) {
    running = true
    index = Math.min(Math.max(0, at), steps.length - 1)
    save({ status: 'running', stepId: steps[index].id })
    emit()
  },

  goTo(next: number | null) {
    if (!running) return
    if (next === null || next >= steps.length) {
      tourStore.finish('done')
      return
    }
    index = Math.max(0, next)
    save({ status: 'running', stepId: steps[index].id })
    emit()
  },

  finish(reason: 'done' | 'skipped') {
    if (!running) return
    running = false
    save({ status: reason })
    emit()
  },

  /** Re-evaluate (e.g. after a grace timer). */
  poke() {
    if (running) emit()
  },

  /** Test hook. */
  _reset(nextSteps: readonly TourStep[] = FIRST_EVENING_TOUR) {
    steps = nextSteps
    persisted = null
    running = false
    index = 0
    screen = null
    targets.clear()
    persist = null
    emit()
  },
}
