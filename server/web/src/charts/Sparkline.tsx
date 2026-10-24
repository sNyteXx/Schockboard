import { linear } from './scale'

/** Tiny trend line for KPI tiles. Values only; the tile carries the label. */
export function Sparkline(props: { values: number[]; color?: string; label: string; height?: number }) {
  const { values, color = 'currentColor', height = 40 } = props
  const width = 160
  if (values.length < 2) return <div className="sparkline-empty" style={{ height }} aria-hidden />
  const min = Math.min(0, ...values)
  const max = Math.max(...values, min + 1)
  const x = linear([0, values.length - 1], [2, width - 4])
  const y = linear([min, max], [height - 3, 3])
  const line = values.map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ')
  const area = `${line} L${x(values.length - 1).toFixed(1)},${height} L${x(0).toFixed(1)},${height} Z`
  const last = values[values.length - 1]
  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={props.label} style={{ height }}>
      <title>{props.label}</title>
      <path d={area} fill={color} opacity={0.12} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={x(values.length - 1)} cy={y(last)} r={3} fill={color} />
    </svg>
  )
}
