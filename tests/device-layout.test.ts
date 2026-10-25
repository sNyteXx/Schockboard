import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({ useWindowDimensions: vi.fn() }))
import { classifyWindowWidth } from '@/hooks/use-device-layout'

describe('adaptive Android layout', () => {
  it('keeps narrow phones compact', () => {
    expect(classifyWindowWidth(393)).toBe('compact')
    expect(classifyWindowWidth(599)).toBe('compact')
  })

  it('recognizes portrait tablets and split-screen windows', () => {
    expect(classifyWindowWidth(600)).toBe('medium')
    expect(classifyWindowWidth(840)).toBe('medium')
  })

  it('uses the expanded two-pane board for wide tablet windows', () => {
    expect(classifyWindowWidth(1000)).toBe('expanded')
    expect(classifyWindowWidth(1280)).toBe('expanded')
  })
})
