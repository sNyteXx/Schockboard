import { useState } from 'react'

import { formatDateTime } from '@/domain/format'

import { ApiError, cancelCommand, type Player } from '../api'
import { Card, Page, StatusBadge, SyncHint } from '../components'
import { COMMAND_LABELS, describeCommand, useApi, useApp } from '../state'

const FILTERS = [
  { value: 'all', label: 'Alle' },
  { value: 'pending', label: 'Ausstehend' },
  { value: 'applied', label: 'Übernommen' },
  { value: 'rejected', label: 'Abgelehnt' },
  { value: 'cancelled', label: 'Storniert' },
] as const

export function CommandsPage() {
  const { commands, status, refresh, toast } = useApp()
  const players = useApi<Player[]>('/players')
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['value']>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const names = new Map((players.data ?? []).map((player) => [player.id, player.name]))
  const visible = commands.filter((command) => filter === 'all' || command.status === filter)

  async function cancel(id: string) {
    setBusy(id)
    try {
      await cancelCommand(id)
      toast('Auftrag storniert.')
      await refresh()
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Fehler.', 'error')
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  return (
    <Page eyebrow="Warteschlange" title="Aufträge" actions={<button className="btn ghost" onClick={() => void refresh()}>Aktualisieren</button>}>
      <SyncHint />
      <div className="segmented">
        {FILTERS.map((entry) => (
          <button key={entry.value} className={filter === entry.value ? 'active' : ''} onClick={() => setFilter(entry.value)}>
            {entry.label}
            {entry.value !== 'all' ? ` (${commands.filter((command) => command.status === entry.value).length})` : ''}
          </button>
        ))}
      </div>
      <Card>
        {visible.length === 0 ? <div className="empty">Keine Aufträge.</div> : null}
        <div className="list">
          {visible.map((command) => {
            const awaitingSnapshot =
              command.status === 'applied' && command.appliedAt && (!status?.lastSnapshotAt || status.lastSnapshotAt < command.appliedAt)
            return (
              <div key={command.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <StatusBadge status={command.status} />
                    <span className="title">{COMMAND_LABELS[command.type]}</span>
                  </div>
                  <div style={{ marginTop: 4 }}>{describeCommand(command, names)}</div>
                  <div className="sub">
                    beauftragt {formatDateTime(command.createdAt)} von {command.createdBy}
                    {command.fetchedAt && command.status === 'pending' ? ' · vom Gerät abgeholt' : ''}
                    {command.appliedAt ? ` · ${command.status === 'rejected' ? 'abgelehnt' : 'übernommen'} ${formatDateTime(command.appliedAt)}` : ''}
                    {command.cancelledAt ? ` · storniert ${formatDateTime(command.cancelledAt)}` : ''}
                  </div>
                  {command.status === 'rejected' && command.error ? (
                    <div className="banner error small" style={{ marginTop: 8 }}>
                      {command.error}
                    </div>
                  ) : null}
                  {awaitingSnapshot ? <div className="sub" style={{ color: 'var(--info)' }}>Neuer Datenstand vom Gerät folgt.</div> : null}
                </div>
                {command.status === 'pending' ? (
                  <button className="btn danger small" disabled={busy === command.id} onClick={() => cancel(command.id)}>
                    Stornieren
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>
      </Card>
    </Page>
  )
}
