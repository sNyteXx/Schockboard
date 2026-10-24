import { describe, expect, it } from 'vitest'

import { easeOutCubic } from '@/components/motion-math'
import { PLAYER_PALETTE, THEMES, colors, hashString, playerColor, playerInitials, setActiveTheme, withAlpha } from '@/theme/tokens'
import { buildTypeScale, getTypeScale, typeScaleFor } from '@/theme/typography'

describe('player identity', () => {
  it('gives every player a stable palette colour', () => {
    expect(playerColor('player_1')).toBe(playerColor('player_1'))
    expect(PLAYER_PALETTE).toContain(playerColor('player_2'))
    expect(hashString('abc')).toBe(hashString('abc'))
    expect(hashString('abc')).not.toBe(hashString('abd'))
  })

  it('spreads ids over the palette', () => {
    const used = new Set(Array.from({ length: 60 }, (_, index) => playerColor(`id-${index}`)))
    expect(used.size).toBeGreaterThanOrEqual(8)
  })

  it('builds initials', () => {
    expect(playerInitials('Anna Lena Meier')).toBe('AM')
    expect(playerInitials('ben')).toBe('BE')
    expect(playerInitials('  ')).toBe('?')
    expect(playerInitials('Ömer')).toBe('ÖM')
  })
})

describe('themes', () => {
  it('defines the same keys for all three themes', () => {
    const keys = Object.keys(THEMES.bvb09).sort()
    for (const id of ['original', 'midnight']) expect(Object.keys(THEMES[id]).sort()).toEqual(keys)
  })

  it('switches the mutable colour bag and falls back to BVB', () => {
    setActiveTheme('midnight')
    expect(colors.accent).toBe(THEMES.midnight.accent)
    setActiveTheme('does-not-exist')
    expect(colors.id).toBe('bvb09')
  })

  it('adds alpha to hex colours only', () => {
    expect(withAlpha('#FFFFFF', 0.5)).toBe('#FFFFFF80')
    expect(withAlpha('rgba(0,0,0,1)', 0.5)).toBe('rgba(0,0,0,1)')
  })
})

describe('type scale', () => {
  it('grows with the window width', () => {
    expect(typeScaleFor(412)).toBe(1)
    expect(typeScaleFor(810)).toBe(1.08)
    expect(typeScaleFor(1180)).toBe(1.15)
    expect(typeScaleFor(1590)).toBe(1.25)
  })

  it('scales sizes and uses tabular numbers for numeric styles', () => {
    const base = buildTypeScale(1)
    const large = buildTypeScale(1.25)
    expect(large.body.fontSize).toBe(Math.round((base.body.fontSize as number) * 1.25))
    expect(base.numeric.fontVariant).toEqual(['tabular-nums'])
    expect(base.body.fontVariant).toBeUndefined()
    expect(base.title.fontFamily).toBe('BarlowCondensed_700Bold')
    expect(getTypeScale(1.08)).toBe(getTypeScale(1.08))
  })
})

describe('motion', () => {
  it('eases out and clamps', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
    expect(easeOutCubic(2)).toBe(1)
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5)
  })
})
