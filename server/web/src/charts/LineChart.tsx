import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react'

import { formatCurrency, formatDate } from '@/domain/format'

import { axisDate, axisEuro, linear, niceTicks, useWidth } from './scale'

export type LinePoint = { t: number; v: number; note?: string }
export type LineSeries = { id: string; label: string; color: string; dashed?: boolean; points: LinePoint[] }

/** Value of a step series at time t (last point at or before t). */
function valueAt(points: LinePoint[], t: number, before: number | null) {
  let value = before
  for (const point of points) {
    if (point.t > t) break
    value = point.v
  }
  return value
}

/**
 * Step-line chart over time (debts and cumulative sums change in steps).
 * One y-axis, recessive grid, crosshair tooltip, legend toggles for ≥ 2
 * series and direct end labels for up to four visible series.
 */
export function LineChart(props: {
  series: LineSeries[]
  height?: number
  /** Series start at 0 at the left edge (cumulative values). */
  startAtZero?: boolean
  initiallyHidden?: string[]
  emptyText?: string
  ariaLabel: string
}) {
  const { series, height = 280, startAtZero = true } = props
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(props.initiallyHidden ?? []))
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  const visible = series.filter((entry) => !hidden.has(entry.id) && entry.points.length > 0)
  const times = useMemo(
    () => [...new Set(visible.flatMap((entry) => entry.points.map((point) => point.t)))].sort((a, b) => a - b),
    [visible]
  )

  const directLabels = visible.length > 0 && visible.length <= 4 && width >= 420
  const pad = { top: 14, right: directLabels ? 84 : 16, bottom: 28, left: 58 }
  const plotWidth = width - pad.left - pad.right
  const plotHeight = height - pad.top - pad.bottom

  const values = visible.flatMap((entry) => entry.points.map((point) => point.v))
  const minValue = Math.min(0, ...values)
  const maxValue = Math.max(0, ...values)
  const ticks = niceTicks(minValue, maxValue, 4)
  const tMin = times[0] ?? 0
  const tMax = times.length > 1 ? times[times.length - 1] : tMin + 86_400_000
  const x = linear([tMin, tMax], [pad.left, pad.left + plotWidth])
  const y = linear([ticks[0], ticks[ticks.length - 1]], [pad.top + plotHeight, pad.top])
  const spanDays = (tMax - tMin) / 86_400_000
  const xTicks = times.length > 1 ? niceTimeTicks(tMin, tMax, Math.max(2, Math.floor(plotWidth / 110))) : [tMin]

  function path(entry: LineSeries) {
    const parts: string[] = []
    let previous: number | null = null
    if (startAtZero && entry.points[0].t > tMin) {
      parts.push(`M${x(tMin).toFixed(1)},${y(0).toFixed(1)}`)
      previous = 0
    }
    for (const point of entry.points) {
      const px = x(point.t).toFixed(1)
      if (previous === null) parts.push(`M${px},${y(point.v).toFixed(1)}`)
      else parts.push(`H${px}`, `V${y(point.v).toFixed(1)}`)
      previous = point.v
    }
    parts.push(`H${x(tMax).toFixed(1)}`)
    return parts.join(' ')
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    if (times.length === 0) return
    const box = event.currentTarget.getBoundingClientRect()
    const px = event.clientX - box.left
    let best = 0
    for (let index = 1; index < times.length; index++) {
      if (Math.abs(x(times[index]) - px) < Math.abs(x(times[best]) - px)) best = index
    }
    setHoverIndex(best)
  }

  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (times.length === 0) return
    if (event.key === 'ArrowRight') setHoverIndex((index) => Math.min(times.length - 1, (index ?? -1) + 1))
    else if (event.key === 'ArrowLeft') setHoverIndex((index) => Math.max(0, (index ?? times.length) - 1))
    else if (event.key === 'Escape') setHoverIndex(null)
    else return
    event.preventDefault()
  }

  const hoverTime = hoverIndex !== null ? times[hoverIndex] : null
  const hoverRows =
    hoverTime === null
      ? []
      : visible
          .map((entry) => ({
            entry,
            value: valueAt(entry.points, hoverTime, startAtZero ? 0 : null),
            note: entry.points.find((point) => point.t === hoverTime)?.note,
          }))
          .filter((row) => row.value !== null)
          .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))

  const tooltipLeft = hoverTime !== null ? x(hoverTime) : 0
  const flip = tooltipLeft > width * 0.6

  const toggle = (id: string) =>
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // End labels: keep at least 13px apart.
  const endLabels = directLabels
    ? visible
        .map((entry) => ({ entry, y: y(entry.points[entry.points.length - 1].v) }))
        .sort((a, b) => a.y - b.y)
        .reduce<Array<{ entry: LineSeries; y: number }>>((placed, label) => {
          const last = placed[placed.length - 1]
          placed.push({ ...label, y: last && label.y - last.y < 13 ? last.y + 13 : label.y })
          return placed
        }, [])
    : []

  return (
    <div className="chart">
      {series.length >= 2 ? (
        <div className="legend" role="group" aria-label="Reihen ein-/ausblenden">
          {series.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`legend-item ${hidden.has(entry.id) ? 'off' : ''}`}
              aria-pressed={!hidden.has(entry.id)}
              onClick={() => toggle(entry.id)}
            >
              <span className={`swatch line ${entry.dashed ? 'dashed' : ''}`} style={{ color: entry.color }} />
              {entry.label}
            </button>
          ))}
        </div>
      ) : null}
      <div ref={ref} className="chart-frame" style={{ height }}>
        {visible.length === 0 ? (
          <div className="empty chart-empty">{props.emptyText ?? 'Noch keine Daten.'}</div>
        ) : (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={props.ariaLabel}
            tabIndex={0}
            onPointerMove={onPointerMove}
            onPointerLeave={() => setHoverIndex(null)}
            onKeyDown={onKeyDown}
            onBlur={() => setHoverIndex(null)}
          >
            {ticks.map((tick) => (
              <g key={tick}>
                <line className={tick === 0 ? 'axis-zero' : 'gridline'} x1={pad.left} x2={pad.left + plotWidth} y1={y(tick)} y2={y(tick)} />
                <text className="axis-label" x={pad.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">
                  {axisEuro(tick)}
                </text>
              </g>
            ))}
            {xTicks
              .map((tick) => ({ tick, label: axisDate(tick, spanDays) }))
              .filter((entry, index, all) => index === 0 || entry.label !== all[index - 1].label)
              .map(({ tick, label }, index, all) => (
                <text
                  key={tick}
                  className="axis-label"
                  x={x(tick)}
                  y={height - 8}
                  textAnchor={all.length === 1 ? 'start' : index === 0 ? 'start' : index === all.length - 1 ? 'end' : 'middle'}
                >
                  {label}
                </text>
              ))}
            {visible.map((entry) => (
              <path
                key={entry.id}
                className="series-line"
                d={path(entry)}
                stroke={entry.color}
                strokeDasharray={entry.dashed ? '5 4' : undefined}
                opacity={hoverRows.length > 0 && visible.length > 1 ? 0.9 : 1}
              />
            ))}
            {endLabels.map(({ entry, y: labelY }) => (
              <text key={entry.id} className="end-label" x={pad.left + plotWidth + 8} y={labelY} dy="0.32em">
                {entry.label.length > 11 ? `${entry.label.slice(0, 10)}…` : entry.label}
              </text>
            ))}
            {hoverTime !== null ? (
              <g pointerEvents="none">
                <line className="crosshair" x1={x(hoverTime)} x2={x(hoverTime)} y1={pad.top} y2={pad.top + plotHeight} />
                {hoverRows.map((row) => (
                  <circle key={row.entry.id} cx={x(hoverTime)} cy={y(row.value ?? 0)} r={4.5} fill={row.entry.color} stroke="var(--bg-elevated)" strokeWidth={2} />
                ))}
              </g>
            ) : null}
          </svg>
        )}
        {hoverTime !== null && hoverRows.length > 0 ? (
          <div
            className="tooltip"
            style={{ left: tooltipLeft, top: pad.top, transform: flip ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)' }}
          >
            <div className="tooltip-title">{formatDate(new Date(hoverTime).toISOString())}</div>
            {hoverRows.slice(0, 10).map((row) => (
              <div key={row.entry.id} className="tooltip-row">
                <span className="swatch" style={{ background: row.entry.color }} />
                <span className="tooltip-name">{row.entry.label}</span>
                <strong className="amount">{formatCurrency(row.value ?? 0)}</strong>
              </div>
            ))}
            {hoverRows.length > 10 ? <div className="muted small">+ {hoverRows.length - 10} weitere</div> : null}
            {visible.length === 1 && hoverRows[0]?.note ? <div className="muted small">{hoverRows[0].note}</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function niceTimeTicks(min: number, max: number, count: number) {
  const step = (max - min) / count
  return Array.from({ length: count + 1 }, (_, index) => min + index * step)
}
