/** Pure geometry helpers for the SVG charts (no React Native imports → testable). */

export type Point = { x: number; y: number }

/** Rounds `max` up to a "nice" axis maximum and returns evenly spaced ticks. */
export function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1]
  const rawStep = max / count
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const residual = rawStep / magnitude
  const nice = residual > 5 ? 10 : residual > 2 ? 5 : residual > 1 ? 2 : 1
  const step = nice * magnitude
  const top = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let value = 0; value <= top + step / 2; value += step) ticks.push(Math.round(value * 1e6) / 1e6)
  return ticks
}

/** Maps values to points inside a box. A single value is drawn as a flat line. */
export function toPoints(values: number[], width: number, height: number, options: { min?: number; max?: number; padY?: number } = {}): Point[] {
  if (values.length === 0) return []
  const padY = options.padY ?? 0
  const min = options.min ?? Math.min(...values)
  const max = options.max ?? Math.max(...values)
  const span = max - min || 1
  const innerHeight = Math.max(0, height - padY * 2)
  const stepX = values.length > 1 ? width / (values.length - 1) : 0
  return values.map((value, index) => ({
    x: values.length > 1 ? index * stepX : width / 2,
    y: padY + innerHeight - ((value - min) / span) * innerHeight,
  }))
}

/** Straight polyline path ("M x y L x y …"). */
export function linePath(points: Point[]) {
  if (points.length === 0) return ''
  if (points.length === 1) {
    const [point] = points
    return `M ${round(point.x - 1)} ${round(point.y)} L ${round(point.x + 1)} ${round(point.y)}`
  }
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${round(point.x)} ${round(point.y)}`).join(' ')
}

/** Smooth monotone-ish path using cardinal-like cubic segments (no overshoot below baseline). */
export function smoothPath(points: Point[], tension = 0.18) {
  if (points.length < 3) return linePath(points)
  let path = `M ${round(points[0].x)} ${round(points[0].y)}`
  for (let index = 0; index < points.length - 1; index++) {
    const previous = points[index - 1] ?? points[index]
    const current = points[index]
    const next = points[index + 1]
    const after = points[index + 2] ?? next
    const c1x = current.x + (next.x - previous.x) * tension
    const c1y = current.y + (next.y - previous.y) * tension
    const c2x = next.x - (after.x - current.x) * tension
    const c2y = next.y - (after.y - current.y) * tension
    const minY = Math.min(current.y, next.y)
    const maxY = Math.max(current.y, next.y)
    path += ` C ${round(c1x)} ${round(clamp(c1y, minY, maxY))} ${round(c2x)} ${round(clamp(c2y, minY, maxY))} ${round(next.x)} ${round(next.y)}`
  }
  return path
}

/** Closes a line path down to the baseline for an area fill. */
export function areaPath(points: Point[], baseline: number, smooth = true) {
  if (points.length === 0) return ''
  const line = smooth ? smoothPath(points) : linePath(points)
  const last = points[points.length - 1]
  const first = points[0]
  return `${line} L ${round(last.x)} ${round(baseline)} L ${round(first.x)} ${round(baseline)} Z`
}

/** Length of the straight polyline – an upper-bound-ish estimate for dash animations. */
export function polylineLength(points: Point[]) {
  let length = 0
  for (let index = 1; index < points.length; index++) {
    length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y)
  }
  return length
}

export type DonutSegment = { value: number; color: string; key: string }
export type DonutArc = DonutSegment & { length: number; offset: number; fraction: number }

/**
 * Splits a circle of `circumference` into stroke-dash arcs. `gap` (in the same
 * unit) separates non-empty segments; zero segments are dropped.
 */
export function donutArcs(segments: DonutSegment[], circumference: number, gap = 0): DonutArc[] {
  const visible = segments.filter((segment) => segment.value > 0)
  const total = visible.reduce((sum, segment) => sum + segment.value, 0)
  if (total <= 0) return []
  const usableGap = visible.length > 1 ? gap : 0
  const available = circumference - usableGap * visible.length
  let cursor = 0
  return visible.map((segment) => {
    const fraction = segment.value / total
    const length = Math.max(0, available * fraction)
    const arc = { ...segment, fraction, length, offset: cursor }
    cursor += length + usableGap
    return arc
  })
}

/** 0..1 share of `value` against `max`, safe for zero / negative inputs. */
export function ratio(value: number, max: number) {
  if (!(max > 0) || !(value > 0)) return 0
  return Math.min(1, value / max)
}

/** Picks at most `max` evenly spread label indices (always first and last). */
export function labelIndices(count: number, max: number) {
  if (count <= 0) return []
  if (count <= max) return Array.from({ length: count }, (_, index) => index)
  const result = new Set<number>([0, count - 1])
  const step = (count - 1) / (max - 1)
  for (let index = 1; index < max - 1; index++) result.add(Math.round(index * step))
  return [...result].sort((left, right) => left - right)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function round(value: number) {
  return Math.round(value * 10) / 10
}
