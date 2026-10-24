import { useEffect, useRef, useState } from 'react'

/**
 * Small helpers for the hand-written SVG charts: scales, ticks, number
 * formats and a width hook so the SVGs render at their real pixel size.
 */

export function linear(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain
  const [r0, r1] = range
  const span = d1 - d0 || 1
  return (value: number) => r0 + ((value - d0) / span) * (r1 - r0)
}

/** "Nice" tick values (1/2/5 steps) covering [min, max]. */
export function niceTicks(min: number, max: number, count = 4) {
  if (min === max) {
    max = min + 100
  }
  const raw = (max - min) / Math.max(1, count)
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= raw) ?? raw
  const start = Math.floor(min / step) * step
  const end = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let value = start; value <= end + step / 2; value += step) ticks.push(Math.round(value))
  return ticks
}

const euroShort = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 })
const euroCompact = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 1 })

/** Axis labels: whole euros, compact from 10.000 €. */
export function axisEuro(cents: number) {
  return Math.abs(cents) >= 1_000_000 ? euroCompact.format(cents / 100) : euroShort.format(cents / 100)
}

const shortDate = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' })
const monthYear = new Intl.DateTimeFormat('de-DE', { month: 'short', year: '2-digit' })

export function axisDate(time: number, spanDays: number) {
  return spanDays > 120 ? monthYear.format(time) : shortDate.format(time)
}

/** Measures the element's content width (ResizeObserver). */
export function useWidth<T extends HTMLElement>(fallback = 600) {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const update = () => setWidth(Math.max(200, Math.round(element.getBoundingClientRect().width)))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

/**
 * Categorical slots for players, validated (dataviz validate_palette.js,
 * dark mode, surface #111611): lightness band, chroma, adjacent CVD ΔE ≥ 8.4.
 * Assigned by a stable player order, never by rank; slots never cycle.
 */
export const SERIES_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']
/** Players beyond the eighth slot share a neutral, dashed line. */
export const OTHER_COLOR = '#7d8a77'

export const ACCENT = '#fde100'
export const STACK_COLORS = { loss: '#fde100', beer: '#3987e5', absence: '#d55181' } as const
