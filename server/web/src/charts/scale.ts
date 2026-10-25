import { WEB_THEME } from '../theme'
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
export function useWidth<T extends HTMLElement>(fallback = 600, min = 40) {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const update = () => setWidth(Math.max(min, Math.round(element.getBoundingClientRect().width)))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [min])
  return [ref, width] as const
}

/**
 * Chart colours come from the app palette: players keep their identity colour
 * (playerColor, FNV-1a of the id – same as in the app), semantic series use
 * the theme tokens.
 */
const c = WEB_THEME
// Resolved hex values (SVG presentation attributes do not reliably take var()).
export const ACCENT = c.accent
export const CHART = { accent: c.accent, info: c.info, warning: c.warning, danger: c.danger, success: c.success, muted: c.muted, subtle: c.subtle }
export const STACK_COLORS = { loss: c.accent, beer: c.info, absence: c.warning } as const
export const CASH_COLORS = { cash: c.accent, withdrawn: c.info, open: c.danger } as const
