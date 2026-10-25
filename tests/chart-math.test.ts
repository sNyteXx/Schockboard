import { describe, expect, it } from 'vitest'

import { areaPath, donutArcs, labelIndices, linePath, niceTicks, polylineLength, ratio, smoothPath, toPoints } from '@/components/charts/chart-math'

describe('niceTicks', () => {
  it('rounds the axis up to friendly steps', () => {
    expect(niceTicks(1840)).toEqual([0, 500, 1000, 1500, 2000])
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8])
    expect(niceTicks(100)).toEqual([0, 50, 100])
  })

  it('handles empty data', () => {
    expect(niceTicks(0)).toEqual([0, 1])
    expect(niceTicks(Number.NaN)).toEqual([0, 1])
  })
})

describe('toPoints / paths', () => {
  it('maps values into the box, max at the top', () => {
    const points = toPoints([0, 5, 10], 100, 50)
    expect(points).toEqual([{ x: 0, y: 50 }, { x: 50, y: 25 }, { x: 100, y: 0 }])
  })

  it('centres a single value and draws a tiny flat line', () => {
    const points = toPoints([3], 100, 40)
    expect(points[0].x).toBe(50)
    expect(linePath(points)).toBe('M 49 40 L 51 40')
  })

  it('respects fixed min/max and padding', () => {
    const points = toPoints([5], 10, 20, { min: 0, max: 10, padY: 2 })
    expect(points[0].y).toBe(10)
  })

  it('never lets smooth curves overshoot between two points', () => {
    const path = smoothPath([{ x: 0, y: 10 }, { x: 10, y: 0 }, { x: 20, y: 10 }, { x: 30, y: 10 }])
    const ys = path.split(/[MLC ]+/).filter(Boolean).map(Number).filter((_, index) => index % 2 === 1)
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...ys)).toBeLessThanOrEqual(10)
  })

  it('closes area paths to the baseline', () => {
    expect(areaPath([{ x: 0, y: 5 }, { x: 10, y: 0 }], 20, false)).toBe('M 0 5 L 10 0 L 10 20 L 0 20 Z')
  })

  it('measures polyline length', () => {
    expect(polylineLength([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 10 }])).toBe(11)
  })
})

describe('donutArcs', () => {
  it('splits the circumference proportionally and drops empty segments', () => {
    const arcs = donutArcs(
      [
        { key: 'paid', value: 300, color: 'a' },
        { key: 'zero', value: 0, color: 'b' },
        { key: 'open', value: 100, color: 'c' },
      ],
      100
    )
    expect(arcs.map((arc) => arc.key)).toEqual(['paid', 'open'])
    expect(arcs[0]).toMatchObject({ length: 75, offset: 0, fraction: 0.75 })
    expect(arcs[1]).toMatchObject({ length: 25, offset: 75 })
  })

  it('leaves gaps only between several segments', () => {
    expect(donutArcs([{ key: 'one', value: 1, color: 'a' }], 100, 4)[0].length).toBe(100)
    const two = donutArcs([{ key: 'a', value: 1, color: 'a' }, { key: 'b', value: 1, color: 'b' }], 100, 4)
    expect(two[0].length).toBe(46)
    expect(two[1].offset).toBe(50)
  })

  it('returns nothing without data', () => {
    expect(donutArcs([{ key: 'a', value: 0, color: 'a' }], 100)).toEqual([])
  })
})

describe('helpers', () => {
  it('clamps ratios', () => {
    expect(ratio(5, 10)).toBe(0.5)
    expect(ratio(15, 10)).toBe(1)
    expect(ratio(-1, 10)).toBe(0)
    expect(ratio(1, 0)).toBe(0)
  })

  it('spreads axis labels evenly incl. first and last', () => {
    expect(labelIndices(3, 5)).toEqual([0, 1, 2])
    expect(labelIndices(12, 4)).toEqual([0, 4, 7, 11])
    expect(labelIndices(0, 4)).toEqual([])
  })
})
