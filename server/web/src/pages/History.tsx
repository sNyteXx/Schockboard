import { useState } from 'react'

import { formatDateTime, formatSignedCurrency } from '@/domain/format'
import { describeHistoryEntry } from '@/domain/history'

import type { HistoryEntry, Player } from '../api'
import { Card, ErrorView, Loading, Page } from '../components'
import { Link, useApi } from '../state'

const KIND_LABELS: Record<HistoryEntry['kind'], string> = {
  loss: 'Verlust',
  beerround: 'Bierrunde',
  absence: 'Abwesenheit',
  payment: 'Zahlung',
  correction: 'Korrektur',
  audit: 'Protokoll',
}

const KIND_BADGES: Record<HistoryEntry['kind'], string> = {
  loss: 'yellow',
  beerround: 'yellow',
  absence: 'info',
  payment: 'success',
  correction: '',
  audit: '',
}

export function HistoryList({ entries, hideSessionTitle = false }: { entries: HistoryEntry[]; hideSessionTitle?: boolean }) {
  if (entries.length === 0) return <div className="empty">Keine Einträge.</div>
  return (
    <div className="list">
      {entries.map((entry) => {
        // Same wording as the app's history screen.
        const { title, detail } = describeHistoryEntry(entry, { hideSessionTitle: true, includeActor: true })
        return (
          <div key={`${entry.kind}-${entry.id}`} className="list-item">
            <div style={{ minWidth: 0 }}>
              <div className="row" style={{ gap: 8 }}>
                <span className={`badge ${KIND_BADGES[entry.kind]}`}>{KIND_LABELS[entry.kind]}</span>
                <span className="title">{entry.kind === 'audit' ? title : detail || title}</span>
              </div>
              <div className="sub" style={{ marginTop: 4 }}>
                {entry.kind === 'audit' && detail ? `${detail} · ` : null}
                {formatDateTime(entry.createdAt)}
                {!hideSessionTitle && entry.sessionTitle && entry.sessionId ? (
                  <>
                    {' · '}
                    <Link to={`/abende/${encodeURIComponent(entry.sessionId)}`}>{entry.sessionTitle}</Link>
                  </>
                ) : null}
              </div>
            </div>
            <span className="amount">{entry.amountCents !== null ? formatSignedCurrency(entry.amountCents) : '—'}</span>
          </div>
        )
      })}
    </div>
  )
}

const KIND_FILTERS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'Alle' },
  { value: 'loss', label: 'Verluste' },
  { value: 'beerround', label: 'Bierrunden' },
  { value: 'absence', label: 'Abwesenheit' },
  { value: 'payment', label: 'Zahlungen' },
  { value: 'correction', label: 'Korrekturen' },
  { value: 'audit', label: 'Protokoll' },
]

export function HistoryPage() {
  const [playerId, setPlayerId] = useState('')
  const [kind, setKind] = useState('all')
  const players = useApi<Player[]>('/players')
  const query = new URLSearchParams({ kind, limit: '500' })
  if (playerId) query.set('playerId', playerId)
  const history = useApi<HistoryEntry[]>(`/history?${query.toString()}`)

  return (
    <Page eyebrow="Alles nachvollziehbar" title="Historie">
      <Card>
        <div className="stack">
          <div className="segmented" role="tablist">
            {KIND_FILTERS.map((filter) => (
              <button key={filter.value} className={kind === filter.value ? 'active' : ''} onClick={() => setKind(filter.value)}>
                {filter.label}
              </button>
            ))}
          </div>
          <label className="field" style={{ maxWidth: 320 }}>
            Spieler
            <select value={playerId} onChange={(event) => setPlayerId(event.target.value)}>
              <option value="">Alle Spieler</option>
              {(players.data ?? []).map((player) => (
                <option key={player.id} value={player.id}>
                  {player.name}
                  {player.isArchived ? ' (archiviert)' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>
      {history.error ? <ErrorView error={history.error} /> : null}
      {!history.data && history.loading ? <Loading /> : null}
      {history.data ? (
        <Card title={`${history.data.length} Einträge`}>
          <HistoryList entries={history.data} />
        </Card>
      ) : null}
    </Page>
  )
}
