import { useState } from 'react'

import { formatCurrency } from '@/domain/format'

export type DonutSlice = { label: string; value: number; color: string; hint?: string }

/**
 * Part-of-whole ring (app: Donut): 2 px gaps between slices, centre value in
 * the scoreboard face, legend with values and shares. Hover/focus on a legend
 * row highlights its slice.
 */
export function Donut(props: { slices: DonutSlice[]; centerLabel: string; centerValue: string; size?: number }) {
  const [active, setActive] = useState<string | null>(null)
  const total = props.slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0)
  const radius = 54
  const stroke = 14
  const circumference = 2 * Math.PI * radius
  const gap = total > 0 && props.slices.filter((slice) => slice.value > 0).length > 1 ? 3 : 0
  let offset = 0
  const share = (value: number) => (total > 0 ? `${Math.round((Math.max(0, value) / total) * 100)} %` : '–')
  return (
    <div className="donut">
      <svg
        viewBox="0 0 140 140"
        style={{ width: props.size ?? 160, height: props.size ?? 160 }}
        role="img"
        aria-label={`${props.centerLabel} ${props.centerValue}. ${props.slices.map((slice) => `${slice.label} ${formatCurrency(slice.value)}`).join(', ')}`}
      >
        <circle cx={70} cy={70} r={radius} fill="none" style={{ stroke: "var(--surface-soft)" }} strokeWidth={stroke} />
        {total > 0
          ? props.slices.map((slice) => {
              const length = (Math.max(0, slice.value) / total) * circumference
              const dash = Math.max(0, length - gap)
              const element = (
                <circle
                  key={slice.label}
                  className={`donut-slice ${active && active !== slice.label ? 'dim' : ''}`}
                  cx={70}
                  cy={70}
                  r={radius}
                  fill="none"
                  stroke={slice.color}
                  strokeWidth={stroke}
                  strokeLinecap="butt"
                  strokeDasharray={`${dash} ${circumference - dash}`}
                  strokeDashoffset={-offset}
                  transform="rotate(-90 70 70)"
                >
                  <title>{`${slice.label}: ${formatCurrency(slice.value)} (${share(slice.value)})`}</title>
                </circle>
              )
              offset += length
              return element
            })
          : null}
        <text x={70} y={74} textAnchor="middle" className="donut-value">
          {props.centerValue}
        </text>
        <text x={70} y={92} textAnchor="middle" className="donut-label">
          {props.centerLabel.toUpperCase()}
        </text>
      </svg>
      <ul className="donut-legend">
        {props.slices.map((slice) => (
          <li
            key={slice.label}
            tabIndex={0}
            onPointerEnter={() => setActive(slice.label)}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive(slice.label)}
            onBlur={() => setActive(null)}
          >
            <span className="swatch" style={{ background: slice.color }} />
            <span className="donut-legend-text">
              <span className="donut-legend-label">{slice.label}</span>
              {slice.hint ? <span className="donut-legend-hint">{slice.hint}</span> : null}
            </span>
            <span className="donut-legend-value">
              <strong className="amount">{formatCurrency(slice.value)}</strong>
              <span className="subtle-text">{share(slice.value)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
