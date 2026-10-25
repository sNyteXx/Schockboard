import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PersistedTour } from '@/components/tour/tour-logic'
import { tourStore } from '@/components/tour/tour-store'

const entry = () => ({ ref: { current: null }, action: { current: undefined }, scroller: null })

describe('tour store', () => {
  afterEach(() => tourStore._reset())

  it('does not notify listeners for target registration while idle', () => {
    const listener = vi.fn()
    const unsubscribe = tourStore.subscribe(listener)
    const unregister = tourStore.registerTarget('evening.tile', entry())
    tourStore.targetLayoutChanged('evening.tile')
    unregister()
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('persists progress and completion', () => {
    const saved: PersistedTour[] = []
    tourStore.setPersistor((state) => saved.push(state))
    tourStore.start(0)
    tourStore.goTo(1)
    tourStore.goTo(null)
    expect(saved).toEqual([{ status: 'running', stepId: 'start' }, { status: 'running', stepId: 'attendance' }, { status: 'done' }])
    expect(tourStore.isRunning()).toBe(false)
  })

  it('skips and resumes', () => {
    tourStore.hydrate({ status: 'running', stepId: 'finish' })
    expect(tourStore.isRunning()).toBe(true)
    expect(tourStore.getIndex()).toBe(7)
    tourStore.finish('skipped')
    expect(tourStore.getPersisted()).toEqual({ status: 'skipped' })
  })

  it('keeps the newest registration of an id', () => {
    const first = entry()
    const second = entry()
    const offFirst = tourStore.registerTarget('evening.beer', first)
    tourStore.registerTarget('evening.beer', second)
    offFirst()
    expect(tourStore.getTarget('evening.beer')).toBe(second)
  })

  it('tracks the focused screen', () => {
    tourStore.setScreen('dashboard', true)
    tourStore.setScreen('evening', true)
    tourStore.setScreen('dashboard', false)
    expect(tourStore.getScreen()).toBe('evening')
    tourStore.setScreen('evening', false)
    expect(tourStore.getScreen()).toBeNull()
  })
})
