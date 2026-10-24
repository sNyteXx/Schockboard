import { useState } from 'react'

import { formatDateTime, formatSignedCurrency } from '@/domain/format'
import { describeHistoryEntry } from '@/domain/history'

import type { HistoryEntry, HistoryRow, Player } from '../api'
import { Card, ErrorView, Loading, Page } from '../components'
import { EntryActions, EntryPendingBadges, Modal, OverrideNotice, useEntryPending, useQueue } from '../overrides'
import { Link, pendingAuditRemoval, useApi, usePendingOverrides } from '../state'

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

export type AuditSelection = { selected: Set<string>; toggle: (id: string) => void }

export function HistoryList({
  entries,
  hideSessionTitle = false,
  editable = false,
  selection,
}: {
  entries: HistoryRow[]
  hideSessionTitle?: boolean
  /** Shows Edit/Delete (silent override) on booking rows and Delete on app-log rows. */
  editable?: boolean
  selection?: AuditSelection
}) {
  if (entries.length === 0) return <div className="empty">Keine Einträge.</div>
  return (
    <div className="list">
      {entries.map((entry) => (
        <HistoryItem key={`${entry.kind}-${entry.id}`} entry={entry} hideSessionTitle={hideSessionTitle} editable={editable} selection={selection} />
      ))}
    </div>
  )
}

function HistoryItem({
  entry,
  hideSessionTitle,
  editable,
  selection,
}: {
  entry: HistoryRow
  hideSessionTitle: boolean
  editable: boolean
  selection?: AuditSelection
}) {
  // Same wording as the app's history screen.
  const { title, detail } = describeHistoryEntry(entry, { hideSessionTitle: true, includeActor: true })
  const { deletion } = useEntryPending(entry.entryKind, entry.id)
  const overrides = usePendingOverrides()
  const isAudit = entry.kind === 'audit'
  const auditRemoval = isAudit ? pendingAuditRemoval(overrides, entry) : undefined
  const [confirmAudit, setConfirmAudit] = useState(false)
  const booking =
    editable && entry.entryKind && entry.amountCents !== null
      ? {
          kind: entry.entryKind,
          id: entry.id,
          amountCents: entry.amountCents,
          note: entry.note ?? null,
          description: `${KIND_LABELS[entry.kind]}${entry.playerName ? ` von ${entry.playerName}` : ''}`,
        }
      : null
  return (
    <div className={`list-item ${deletion || auditRemoval ? 'struck' : ''}`}>
      {isAudit && editable && selection ? (
        <input
          type="checkbox"
          className="row-check"
          aria-label="Protokolleintrag auswählen"
          disabled={Boolean(auditRemoval)}
          checked={selection.selected.has(entry.id)}
          onChange={() => selection.toggle(entry.id)}
        />
      ) : null}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="row" style={{ gap: 8 }}>
          <span className={`badge ${KIND_BADGES[entry.kind]}`}>{KIND_LABELS[entry.kind]}</span>
          <span className="title strike">{isAudit ? title : detail || title}</span>
        </div>
        <div className="sub" style={{ marginTop: 4 }}>
          {isAudit && detail ? `${detail} · ` : null}
          {formatDateTime(entry.createdAt)}
          {!hideSessionTitle && entry.sessionTitle && entry.sessionId ? (
            <>
              {' · '}
              <Link to={`/abende/${encodeURIComponent(entry.sessionId)}`}>{entry.sessionTitle}</Link>
            </>
          ) : null}
        </div>
        <EntryPendingBadges kind={entry.entryKind} id={entry.id} />
        {auditRemoval ? (
          <div className="pending-note">
            <span className="badge pending">ausstehend: wird aus dem App-Protokoll entfernt</span>
          </div>
        ) : null}
      </div>
      <div className="item-end">
        <span className="amount strike">{entry.amountCents !== null ? formatSignedCurrency(entry.amountCents) : '—'}</span>
        {booking ? <EntryActions booking={booking} /> : null}
        {isAudit && editable ? (
          <button type="button" className="btn danger small" disabled={Boolean(auditRemoval)} onClick={() => setConfirmAudit(true)}>
            Löschen
          </button>
        ) : null}
      </div>
      {confirmAudit ? <DeleteAuditDialog ids={[entry.id]} onClose={() => setConfirmAudit(false)} /> : null}
    </div>
  )
}

const AUDIT_COPY =
  'Entfernt die Einträge still beim nächsten Hintergrund-Sync aus dem Protokoll der App. Buchungen und Kontostände bleiben unverändert.'

function DeleteAuditDialog({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone?: () => void }) {
  const { run, busy } = useQueue()
  return (
    <Modal title={ids.length === 1 ? 'Protokolleintrag löschen?' : `${ids.length} Protokolleinträge löschen?`} onClose={onClose} tone="danger">
      <div className="stack">
        <div>{AUDIT_COPY}</div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>
            Abbrechen
          </button>
          <button
            type="button"
            className="btn danger solid"
            disabled={busy}
            onClick={async () => {
              if (await run('audit.delete', { auditIds: ids }, 'Löschung im App-Protokoll beauftragt.')) {
                onDone?.()
                onClose()
              }
            }}
          >
            Löschen beauftragen
          </button>
        </div>
      </div>
    </Modal>
  )
}

function PurgeAuditDialog({ onClose }: { onClose: () => void }) {
  const { run, busy } = useQueue()
  const [mode, setMode] = useState<'all' | 'before'>('all')
  const [date, setDate] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const valid = confirmText.trim().toUpperCase() === 'LEEREN' && (mode === 'all' || Boolean(date))
  return (
    <Modal title="App-Protokoll leeren?" onClose={onClose} tone="danger">
      <form
        className="stack"
        onSubmit={async (event) => {
          event.preventDefault()
          if (!valid) return
          const payload = mode === 'before' ? { before: new Date(`${date}T00:00:00`).toISOString() } : {}
          if (await run('audit.purge', payload, 'Leeren des App-Protokolls beauftragt.')) onClose()
        }}
      >
        <div className="segmented">
          <button type="button" className={mode === 'all' ? 'active' : ''} onClick={() => setMode('all')}>
            Alles
          </button>
          <button type="button" className={mode === 'before' ? 'active' : ''} onClick={() => setMode('before')}>
            Nur vor einem Datum
          </button>
        </div>
        {mode === 'before' ? (
          <label className="field">
            Einträge vor dem
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
          </label>
        ) : null}
        <div className="banner error small">
          {mode === 'all' ? 'Das gesamte Protokoll der App' : 'Alle Protokolleinträge vor diesem Datum'} wird endgültig gelöscht. {AUDIT_COPY}
        </div>
        <label className="field">
          Zur Bestätigung „LEEREN“ eingeben
          <input value={confirmText} onChange={(event) => setConfirmText(event.target.value)} autoComplete="off" />
        </label>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn danger solid" disabled={busy || !valid}>
            Protokoll leeren
          </button>
        </div>
      </form>
    </Modal>
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
  const [showAudit, setShowAudit] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dialog, setDialog] = useState<'delete' | 'purge' | null>(null)
  const players = useApi<Player[]>('/players')
  const query = new URLSearchParams({ kind, limit: '500' })
  if (playerId) query.set('playerId', playerId)
  if (showAudit) query.set('includeAudit', '1')
  const history = useApi<HistoryRow[]>(`/history?${query.toString()}`)
  const auditVisible = showAudit || kind === 'audit'

  const selection: AuditSelection = {
    selected,
    toggle: (id) =>
      setSelected((current) => {
        const next = new Set(current)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      }),
  }
  const visibleAuditIds = (history.data ?? []).filter((entry) => entry.kind === 'audit').map((entry) => entry.id)
  const selectedIds = visibleAuditIds.filter((id) => selected.has(id))

  return (
    <Page eyebrow="Alle Buchungen" title="Historie">
      <Card>
        <div className="stack">
          <div className="segmented" role="tablist">
            {KIND_FILTERS.map((filter) => (
              <button key={filter.value} className={kind === filter.value ? 'active' : ''} onClick={() => setKind(filter.value)}>
                {filter.label}
              </button>
            ))}
          </div>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <label className="field" style={{ maxWidth: 320, flex: '1 1 220px' }}>
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
            {kind === 'all' ? (
              <label className="checkbox small">
                <input type="checkbox" checked={showAudit} onChange={(event) => setShowAudit(event.target.checked)} />
                Protokoll anzeigen
              </label>
            ) : null}
            <button type="button" className="btn danger small" onClick={() => setDialog('purge')}>
              App-Protokoll leeren
            </button>
          </div>
        </div>
      </Card>
      {history.error ? <ErrorView error={history.error} /> : null}
      {!history.data && history.loading ? <Loading /> : null}
      {history.data ? (
        <Card
          title={`${history.data.length} Einträge`}
          actions={
            auditVisible && visibleAuditIds.length > 0 ? (
              <div className="row">
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() => setSelected(selectedIds.length === visibleAuditIds.length ? new Set() : new Set(visibleAuditIds))}
                >
                  {selectedIds.length === visibleAuditIds.length ? 'Auswahl aufheben' : 'Alle Protokolleinträge wählen'}
                </button>
                <button type="button" className="btn danger small" disabled={selectedIds.length === 0} onClick={() => setDialog('delete')}>
                  {selectedIds.length} ausgewählte löschen
                </button>
              </div>
            ) : null
          }
        >
          <div style={{ marginBottom: 12 }}>
            <OverrideNotice />
          </div>
          <HistoryList entries={history.data} editable selection={auditVisible ? selection : undefined} />
        </Card>
      ) : null}
      {dialog === 'delete' ? <DeleteAuditDialog ids={selectedIds} onClose={() => setDialog(null)} onDone={() => setSelected(new Set())} /> : null}
      {dialog === 'purge' ? <PurgeAuditDialog onClose={() => setDialog(null)} /> : null}
    </Page>
  )
}
