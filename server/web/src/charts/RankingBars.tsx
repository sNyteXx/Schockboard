import type { ReactNode } from 'react'

import { formatCurrency } from '@/domain/format'

import { Avatar } from '../components'

export type RankingRow = {
  id: string
  label: ReactNode
  value: number
  /** Player avatar in front of the label. */
  avatar?: { id: string; name: string; muted?: boolean }
  sub?: ReactNode
  extra?: ReactNode
  onClick?: () => void
}

/**
 * Horizontal ranking bars (app: BarChart): avatar, label, value; debt in the
 * accent, credit (negative) in the success tone, the leader highlighted.
 */
export function RankingBars(props: { rows: RankingRow[]; emptyText?: string; limit?: number }) {
  const rows = props.limit ? props.rows.slice(0, props.limit) : props.rows
  const max = Math.max(1, ...rows.map((row) => Math.abs(row.value)))
  if (rows.length === 0) return <div className="empty compact">{props.emptyText ?? 'Keine Daten.'}</div>
  return (
    <ol className="ranking">
      {rows.map((row, index) => {
        const content = (
          <>
            {row.avatar ? <Avatar id={row.avatar.id} name={row.avatar.name} size={30} muted={row.avatar.muted} ring={index === 0 && row.value > 0} /> : null}
            <span className="ranking-main">
              <span className="ranking-head">
                <span className="ranking-label">{row.label}</span>
                <span className={`amount ${row.value > 0 ? 'debt' : row.value < 0 ? 'credit' : ''}`}>{formatCurrency(row.value)}</span>
              </span>
              <span className="ranking-track" aria-hidden>
                <span
                  className={`ranking-bar ${row.value < 0 ? 'credit' : index === 0 ? 'lead' : ''}`}
                  style={{ width: `${row.value === 0 ? 0 : Math.max(2, (Math.abs(row.value) / max) * 100)}%` }}
                />
              </span>
              {row.sub ? <span className="ranking-sub">{row.sub}</span> : null}
              {row.extra}
            </span>
          </>
        )
        return (
          <li key={row.id}>
            {row.onClick ? (
              <button type="button" className="ranking-row clickable" onClick={row.onClick}>
                {content}
              </button>
            ) : (
              <div className="ranking-row">{content}</div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
