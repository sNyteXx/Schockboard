import { formatCurrency } from '@/domain/format'

export type DonutSlice = { label: string; value: number; color: string }

/** Two-to-few part share with a centre total; legend lists values in text ink. */
export function Donut(props: { slices: DonutSlice[]; centerLabel: string; centerValue: string }) {
  const total = props.slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0)
  const radius = 54
  const circumference = 2 * Math.PI * radius
  const gap = total > 0 && props.slices.filter((slice) => slice.value > 0).length > 1 ? 3 : 0
  let offset = 0
  return (
    <div className="donut">
      <svg viewBox="0 0 140 140" role="img" aria-label={props.slices.map((slice) => `${slice.label} ${formatCurrency(slice.value)}`).join(', ')}>
        <circle cx={70} cy={70} r={radius} fill="none" stroke="var(--surface)" strokeWidth={16} />
        {total > 0
          ? props.slices.map((slice) => {
              const length = (Math.max(0, slice.value) / total) * circumference
              const dash = Math.max(0, length - gap)
              const element = (
                <circle
                  key={slice.label}
                  className="donut-slice"
                  cx={70}
                  cy={70}
                  r={radius}
                  fill="none"
                  stroke={slice.color}
                  strokeWidth={16}
                  strokeDasharray={`${dash} ${circumference - dash}`}
                  strokeDashoffset={-offset}
                  transform="rotate(-90 70 70)"
                >
                  <title>{`${slice.label}: ${formatCurrency(slice.value)} (${Math.round((slice.value / total) * 100)} %)`}</title>
                </circle>
              )
              offset += length
              return element
            })
          : null}
        <text x={70} y={64} textAnchor="middle" className="donut-label">
          {props.centerLabel}
        </text>
        <text x={70} y={84} textAnchor="middle" className="donut-value">
          {props.centerValue}
        </text>
      </svg>
      <div className="legend vertical">
        {props.slices.map((slice) => (
          <div key={slice.label} className="legend-item static">
            <span className="swatch" style={{ background: slice.color }} />
            <span>{slice.label}</span>
            <strong className="amount">{formatCurrency(slice.value)}</strong>
            <span className="muted small">{total > 0 ? `${Math.round((Math.max(0, slice.value) / total) * 100)} %` : '–'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
