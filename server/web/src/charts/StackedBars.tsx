import { useState } from 'react'

import { formatCurrency, formatDate } from '@/domain/format'

import { axisEuro, linear, niceTicks, useWidth } from './scale'

export type StackSegment = { key: string; label: string; color: string }
export type StackColumn = { id: string; label: string; date: string; values: Record<string, number> }

/**
 * Vertical stacked bars (one per evening). 2px surface gap between segments,
 * rounded top on the stack, hover tooltip with the breakdown, click opens.
 */
export function StackedBars(props: {
  columns: StackColumn[]
  segments: StackSegment[]
  height?: number
  onSelect?: (id: string) => void
  ariaLabel: string
}) {
  const { columns, segments, height = 260 } = props
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)

  const pad = { top: 12, right: 8, bottom: 30, left: 58 }
  const plotWidth = width - pad.left - pad.right
  const plotHeight = height - pad.top - pad.bottom
  const totals = columns.map((column) => segments.reduce((sum, segment) => sum + Math.max(0, column.values[segment.key] ?? 0), 0))
  const ticks = niceTicks(0, Math.max(100, ...totals), 4)
  const y = linear([0, ticks[ticks.length - 1]], [pad.top + plotHeight, pad.top])
  const slot = plotWidth / Math.max(1, columns.length)
  const barWidth = Math.max(3, Math.min(44, slot * 0.66))
  const labelEvery = Math.max(1, Math.ceil(56 / slot))

  const hovered = hover !== null ? columns[hover] : null
  const hoverX = hover !== null ? pad.left + slot * hover + slot / 2 : 0

  return (
    <div className="chart">
      <div className="legend">
        {segments.map((segment) => (
          <span key={segment.key} className="legend-item static">
            <span className="swatch" style={{ background: segment.color }} />
            {segment.label}
          </span>
        ))}
      </div>
      <div ref={ref} className="chart-frame" style={{ height }}>
        {columns.length === 0 ? (
          <div className="empty chart-empty">Keine beendeten Abende in diesem Zeitraum.</div>
        ) : (
          <svg width={width} height={height} role="img" aria-label={props.ariaLabel} onPointerLeave={() => setHover(null)}>
            {ticks.map((tick) => (
              <g key={tick}>
                <line className={tick === 0 ? 'axis-zero' : 'gridline'} x1={pad.left} x2={pad.left + plotWidth} y1={y(tick)} y2={y(tick)} />
                <text className="axis-label" x={pad.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">
                  {axisEuro(tick)}
                </text>
              </g>
            ))}
            {columns.map((column, index) => {
              const cx = pad.left + slot * index + slot / 2
              let accumulated = 0
              const visibleSegments = segments.filter((segment) => (column.values[segment.key] ?? 0) > 0)
              return (
                <g
                  key={column.id}
                  className={`bar-group ${hover !== null && hover !== index ? 'dim' : ''}`}
                  onPointerEnter={() => setHover(index)}
                  onFocus={() => setHover(index)}
                  onBlur={() => setHover(null)}
                  onClick={() => props.onSelect?.(column.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      props.onSelect?.(column.id)
                    }
                  }}
                  tabIndex={props.onSelect ? 0 : undefined}
                  role={props.onSelect ? 'button' : undefined}
                  aria-label={`${column.label}, ${formatDate(column.date)}: ${formatCurrency(totals[index])}`}
                  style={{ cursor: props.onSelect ? 'pointer' : undefined }}
                >
                  {/* generous hit target over the whole column */}
                  <rect x={pad.left + slot * index} y={pad.top} width={slot} height={plotHeight} fill="transparent" />
                  {visibleSegments.map((segment, segmentIndex) => {
                    const value = column.values[segment.key] ?? 0
                    const bottom = y(accumulated)
                    accumulated += value
                    const top = y(accumulated)
                    // 2px surface gap towards the segment below
                    const gap = segmentIndex > 0 ? 2 : 0
                    const rectHeight = Math.max(1, bottom - top - gap)
                    const isTop = segmentIndex === visibleSegments.length - 1
                    const radius = isTop ? Math.min(4, barWidth / 2, rectHeight) : 0
                    return (
                      <path
                        key={segment.key}
                        d={roundedTop(cx - barWidth / 2, top, barWidth, rectHeight, radius)}
                        fill={segment.color}
                      />
                    )
                  })}
                  {index % labelEvery === 0 ? (
                    <text className="axis-label" x={cx} y={height - 10} textAnchor="middle">
                      {new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' }).format(new Date(column.date))}
                    </text>
                  ) : null}
                </g>
              )
            })}
          </svg>
        )}
        {hovered ? (
          <div
            className="tooltip"
            style={{ left: hoverX, top: pad.top, transform: hoverX > width * 0.6 ? 'translateX(calc(-100% - 14px))' : 'translateX(14px)' }}
          >
            <div className="tooltip-title">{hovered.label}</div>
            <div className="muted small">{formatDate(hovered.date)}</div>
            {segments.map((segment) => (
              <div key={segment.key} className="tooltip-row">
                <span className="swatch" style={{ background: segment.color }} />
                <span className="tooltip-name">{segment.label}</span>
                <strong className="amount">{formatCurrency(hovered.values[segment.key] ?? 0)}</strong>
              </div>
            ))}
            <div className="tooltip-row total">
              <span className="tooltip-name">Gesamt</span>
              <strong className="amount">{formatCurrency(totals[hover ?? 0])}</strong>
            </div>
            {props.onSelect ? <div className="muted small">Klicken für Details</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** Rect path with only the top corners rounded (data end), flat on the baseline. */
function roundedTop(x: number, y: number, width: number, height: number, radius: number) {
  if (radius <= 0) return `M${x},${y} h${width} v${height} h${-width} Z`
  return `M${x},${y + height} V${y + radius} Q${x},${y} ${x + radius},${y} H${x + width - radius} Q${x + width},${y} ${x + width},${y + radius} V${y + height} Z`
}
