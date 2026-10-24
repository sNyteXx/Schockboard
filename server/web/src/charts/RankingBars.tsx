import type { ReactNode } from 'react'

import { formatCurrency } from '@/domain/format'

export type RankingRow = { id: string; label: ReactNode; value: number; extra?: ReactNode; onClick?: () => void }

/** Horizontal bars sorted by value; negative values (credit) are drawn in the success tone. */
export function RankingBars(props: { rows: RankingRow[]; emptyText?: string }) {
  const max = Math.max(1, ...props.rows.map((row) => Math.abs(row.value)))
  if (props.rows.length === 0) return <div className="empty">{props.emptyText ?? 'Keine Daten.'}</div>
  return (
    <div className="ranking">
      {props.rows.map((row) => {
        const Tag = row.onClick ? 'button' : 'div'
        return (
          <Tag key={row.id} className={`ranking-row ${row.onClick ? 'clickable' : ''}`} onClick={row.onClick} type={row.onClick ? 'button' : undefined}>
            <div className="ranking-head">
              <span className="ranking-label">{row.label}</span>
              <span className={`amount ${row.value > 0 ? 'debt' : row.value < 0 ? 'neg' : ''}`}>{formatCurrency(row.value)}</span>
            </div>
            <div className="ranking-track">
              <div
                className={`ranking-bar ${row.value < 0 ? 'credit' : ''}`}
                style={{ width: `${row.value === 0 ? 0 : Math.max(1.5, (Math.abs(row.value) / max) * 100)}%` }}
              />
            </div>
            {row.extra}
          </Tag>
        )
      })}
    </div>
  )
}
