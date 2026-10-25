import { useState } from 'react'

import { formatDateTime } from '@/domain/format'

import { api, ApiError, type Player, type SessionOverview, type StoredCommand } from '../api'
import { Button, Card, Chips, EmptyState, Notice, Page, relativeTime, StatusBadge, SyncHint } from '../components'
import { ConfirmDialog } from '../dialog'
import { Icon, type IconName } from '../icons'
import { useUndo } from '../overrides'
import { COMMAND_LABELS, describeCommand, useApi, useApp, useSearch } from '../state'

const FILTERS = [
  { value: 'all', label: 'Alle' },
  { value: 'pending', label: 'Ausstehend' },
  { value: 'applied', label: 'Übernommen' },
  { value: 'rejected', label: 'Abgelehnt' },
  { value: 'cancelled', label: 'Storniert' },
] as const

type Filter = (typeof FILTERS)[number]['value']

const STATUS_ICONS: Record<StoredCommand['status'], IconName> = { pending: 'time', applied: 'check', rejected: 'alert', cancelled: 'undo' }

export function CommandsPage() {
  const { commands, status, refresh, toast, selectedDevice, activeDevices } = useApp()
  const search = useSearch()
  const initial = new URLSearchParams(search).get('filter') as Filter | null
  const [filter, setFilter] = useState<Filter>(initial && FILTERS.some((entry) => entry.value === initial) ? initial : 'all')
  const [clearAll, setClearAll] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearing, setClearing] = useState(false)
  const { undo, busy } = useUndo()
  const players = useApi<Player[]>('/players')
  const sessions = useApi<SessionOverview[]>('/sessions')
  const names = new Map((players.data ?? []).map((player) => [player.id, player.name]))
  const sessionNames = new Map((sessions.data ?? []).map((session) => [session.id, session.title]))
  const finishedCount = commands.filter((command) => command.status !== 'pending').length
  const visible = commands.filter((command) => filter === 'all' || command.status === filter)

  async function clearHistory() {
    setClearing(true)
    try {
      const result = await api<{ deleted: number }>(clearAll ? '/commands?device=all' : '/commands', { method: 'DELETE' })
      toast(`${result.deleted} abgeschlossene Aufträge gelöscht.`)
      setConfirmClear(false)
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Fehler.', 'error')
    } finally {
      await refresh()
      setClearing(false)
    }
  }

  return (
    <Page
      title="Aufträge"
      icon="layers"
      context={selectedDevice ? `Warteschlange von „${selectedDevice.label}“` : 'Warteschlange'}
      actions={
        <>
          <Button variant="ghost" size="sm" icon="refresh" onClick={() => void refresh()}>
            Aktualisieren
          </Button>
          <Button
            variant="danger"
            size="sm"
            icon="trash"
            disabled={finishedCount === 0}
            onClick={() => {
              setClearAll(false)
              setConfirmClear(true)
            }}
          >
            Verlauf leeren
          </Button>
        </>
      }
    >
      <Card className="table-card">
        <div className="toolbar">
          <Chips
            label="Status"
            value={filter}
            onChange={setFilter}
            options={FILTERS.map((entry) => ({
              value: entry.value,
              label: entry.label,
              count: entry.value === 'all' ? commands.length : commands.filter((command) => command.status === entry.value).length,
            }))}
          />
        </div>
        {visible.length === 0 ? (
          <EmptyState icon="layers" title="Keine Aufträge" text={filter === 'pending' ? 'Nichts wartet auf das Gerät.' : 'In dieser Ansicht gibt es keine Aufträge.'} />
        ) : (
          <ul className="list">
            {visible.map((command) => {
              const awaitingSnapshot =
                command.status === 'applied' && command.appliedAt && (!status?.lastSnapshotAt || status.lastSnapshotAt < command.appliedAt)
              return (
                <li key={command.id} className="list-row">
                  <div className="list-row-main">
                    <span className={`list-lead tone-${command.status}`}>
                      <Icon name={STATUS_ICONS[command.status]} size={16} />
                    </span>
                    <div className="list-text">
                      <div className="list-title">
                        {COMMAND_LABELS[command.type]} <StatusBadge status={command.status} />
                      </div>
                      <div className="list-body">{describeCommand(command, names, sessionNames)}</div>
                      <div className="list-meta">
                        <time dateTime={command.createdAt} title={formatDateTime(command.createdAt)}>
                          beauftragt {relativeTime(command.createdAt)}
                        </time>{' '}
                        von {command.createdBy}
                        {command.fetchedAt && command.status === 'pending' ? ' · vom Gerät abgeholt' : ''}
                        {command.appliedAt ? ` · ${command.status === 'rejected' ? 'abgelehnt' : 'übernommen'} ${formatDateTime(command.appliedAt)}` : ''}
                        {command.cancelledAt ? ` · storniert ${formatDateTime(command.cancelledAt)}` : ''}
                      </div>
                      {command.status === 'rejected' && command.error ? <Notice tone="danger">{command.error}</Notice> : null}
                      {awaitingSnapshot ? <div className="list-meta tone-info-text">Neuer Datenstand vom Gerät folgt.</div> : null}
                    </div>
                    {command.status === 'pending' ? (
                      <Button variant="ghost" size="sm" icon="undo" disabled={busy === command.id} onClick={() => void undo(command)}>
                        zurücknehmen
                      </Button>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <div className="card-foot">Abgeschlossene Aufträge werden nach einiger Zeit automatisch gelöscht (Standard: 30 Tage).</div>
      </Card>
      <SyncHint />
      {confirmClear ? (
        <ConfirmDialog
          title="Auftragsverlauf leeren?"
          tone="danger"
          confirmLabel="Verlauf leeren"
          busy={clearing}
          onClose={() => setConfirmClear(false)}
          onConfirm={clearHistory}
        >
          <p>
            {clearAll
              ? 'Alle abgeschlossenen Aufträge (übernommen, abgelehnt, storniert) aller Geräte'
              : `${finishedCount} abgeschlossene Aufträge (übernommen, abgelehnt, storniert) von „${selectedDevice?.label ?? 'diesem Gerät'}“`}{' '}
            werden vom Server gelöscht. Ausstehende Aufträge bleiben erhalten.
          </p>
          {activeDevices.length > 1 ? (
            <label className="checkbox">
              <input type="checkbox" checked={clearAll} onChange={(event) => setClearAll(event.target.checked)} /> Verlauf aller Geräte leeren
            </label>
          ) : null}
          <Notice tone="danger">Danach lässt sich im Web nicht mehr nachvollziehen, was beauftragt wurde.</Notice>
        </ConfirmDialog>
      ) : null}
    </Page>
  )
}
