import { useEffect, useRef, useState } from 'react'

/**
 * Calm motion, same rules as the app (src/components/motion.tsx): 120–240 ms
 * UI transitions on bezier(0.2, 0, 0, 1), no springs, no overshoot, and
 * nothing at all with prefers-reduced-motion. CSS uses var(--ease)/--dur-*.
 */

const QUERY = '(prefers-reduced-motion: reduce)'

export function prefersReducedMotion() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(prefersReducedMotion)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(QUERY)
    const update = () => setReduced(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return reduced
}

const easeOutCubic = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3

/**
 * Counts from the previous value to `value` (first mount: from 0), like the
 * app's AnimatedNumber. Only for a handful of KPI numbers.
 */
export function useCountUp(value: number, duration = 650) {
  const reduced = useReducedMotion()
  const [display, setDisplay] = useState(reduced ? value : 0)
  const from = useRef(reduced ? value : 0)

  useEffect(() => {
    if (reduced) {
      from.current = value
      setDisplay(value)
      return
    }
    const start = from.current
    if (start === value) return
    const startedAt = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const progress = (now - startedAt) / duration
      const next = progress >= 1 ? value : Math.round(start + (value - start) * easeOutCubic(progress))
      from.current = next
      setDisplay(next)
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value, duration, reduced])

  return display
}
