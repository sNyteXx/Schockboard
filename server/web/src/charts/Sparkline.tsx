import { useId } from 'react'

import { linear, useWidth } from './scale'

/**
 * Tiny trend line with a soft area fill (app: Sparkline). Measures its own
 * width so the end dot stays round. Values only; the tile carries the label.
 */
export function Sparkline(props: { values: number[]; color?: string; label: string; height?: number }) {
  const { values, color = 'currentColor', height = 36 } = props
  const [ref, width] = useWidth<HTMLSpanElement>(140)
  const gradientId = `spark-${useId().replace(/:/g, '')}`
  if (values.length < 2) return <span className="sparkline-empty" style={{ height }} aria-hidden />
  const pad = 4
  const min = Math.min(...values)
  const max = Math.max(...values)
  const x = linear([0, values.length - 1], [pad, width - pad])
  const y = linear([min, max === min ? min + 1 : max], [height - pad, pad])
  const points = values.map((value, index) => [x(index), y(value)] as const)
  const line = points.map(([px, py], index) => `${index === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ')
  const area = `${line} L${points[points.length - 1][0].toFixed(1)},${height} L${points[0][0].toFixed(1)},${height} Z`
  const [lastX, lastY] = points[points.length - 1]
  return (
    <span ref={ref} className="sparkline-wrap" style={{ height }}>
      <svg className="sparkline" width={width} height={height} role="img" aria-label={props.label}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity={0.28} />
            <stop offset="1" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradientId})`} />
        <path className="spark-line" d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" pathLength={1} />
        <circle cx={lastX} cy={lastY} r={3} fill={color} />
      </svg>
    </span>
  )
}
